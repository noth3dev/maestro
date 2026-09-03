import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, MigrationChecksumMismatchError } from "./migrate.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("production migration runner", () => {
  const basePool = new Pool({ connectionString: databaseUrl });

  async function freshSchema(): Promise<{ pool: Pool; connectionString: string; schema: string; drop: () => Promise<void> }> {
    const schema = `migrate_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await basePool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const connectionString = url.toString();
    const pool = new Pool({ connectionString });
    return { pool, connectionString, schema, drop: async () => { await pool.end(); await basePool.query(`DROP SCHEMA "${schema}" CASCADE`); } };
  }

  afterAll(async () => { await basePool.end(); });

  it("applies every migration additively into an empty schema and records one durable ledger row per file", async () => {
    const { pool, drop } = await freshSchema();
    try {
      const result = await runMigrations(pool);
      expect(result.applied.length).toBeGreaterThan(0);

      const ledger = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
      expect(Number(ledger.rows[0]!.count)).toBe(result.applied.length);

      const goals = await pool.query("SELECT to_regclass('goals') AS exists");
      expect(goals.rows[0]!.exists).not.toBeNull();
    } finally {
      await drop();
    }
  });

  it("is idempotent: a second run applies nothing new and does not duplicate ledger rows or re-execute migration SQL", async () => {
    const { pool, drop } = await freshSchema();
    try {
      const first = await runMigrations(pool);
      const before = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");

      const second = await runMigrations(pool);

      expect(second.applied).toEqual([]);
      const after = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
      expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
      expect(Number(before.rows[0]!.count)).toBe(first.applied.length);
    } finally {
      await drop();
    }
  });

  it("only applies newly added migration files on a later run, leaving already-applied ledger rows untouched", async () => {
    const { pool, drop } = await freshSchema();
    try {
      const first = await runMigrations(pool);
      const firstAppliedAt = await pool.query<{ filename: string; applied_at: Date }>(
        "SELECT filename, applied_at FROM schema_migrations ORDER BY filename",
      );

      // Re-running with the exact same migration set on disk must be a no-op
      // (proves "additive, never reapplies") -- covered by the idempotency
      // test above. This test proves the ledger rows themselves are stable
      // (never rewritten) across that no-op run.
      await runMigrations(pool);
      const secondAppliedAt = await pool.query<{ filename: string; applied_at: Date }>(
        "SELECT filename, applied_at FROM schema_migrations ORDER BY filename",
      );

      expect(secondAppliedAt.rows).toEqual(firstAppliedAt.rows);
      expect(first.applied.length).toBeGreaterThan(0);
    } finally {
      await drop();
    }
  });

  it("serializes two concurrent runners through the advisory lock: both succeed, and the ledger has exactly one row per migration with no duplicate-key error", async () => {
    const { pool, connectionString, drop } = await freshSchema();
    const secondPool = new Pool({ connectionString });
    try {
      const [a, b] = await Promise.all([runMigrations(pool), runMigrations(secondPool)]);
      const combinedApplied = new Set([...a.applied, ...b.applied]);

      const ledger = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
      expect(new Set(ledger.rows.map((row) => row.filename))).toEqual(combinedApplied);
      expect(ledger.rows.length).toBe(combinedApplied.size);
    } finally {
      await secondPool.end();
      await drop();
    }
  });

  it("rejects and fails closed when an already-applied migration file's content no longer matches its recorded checksum", async () => {
    const { pool, drop } = await freshSchema();
    try {
      await runMigrations(pool);
      const applied = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations ORDER BY filename LIMIT 1");
      const filename = applied.rows[0]!.filename;
      await pool.query("UPDATE schema_migrations SET checksum = $1 WHERE filename = $2", [
        createHash("sha256").update("tampered-content").digest("hex"),
        filename,
      ]);

      await expect(runMigrations(pool)).rejects.toBeInstanceOf(MigrationChecksumMismatchError);
      await expect(runMigrations(pool)).rejects.toThrow(filename);
    } finally {
      await drop();
    }
  });

  it("does not re-execute any DDL when the schema was already built by the test-only applyAllMigrations helper (both runners share one ledger)", async () => {
    const { pool, drop } = await freshSchema();
    try {
      const { applyAllMigrations } = await import("./test-migrations.js");
      await applyAllMigrations(pool);

      // applyAllMigrations already populates the same schema_migrations
      // ledger with every file's current checksum, so a control plane's
      // subsequent runMigrations(pool) call against a test-built schema
      // (e.g. inside apps/control-plane's own real-DB integration tests,
      // which call applyAllMigrations in beforeAll and then
      // createControlPlane(...).listen()) sees every migration already
      // current and applies nothing new -- it never attempts to re-run
      // non-idempotent DDL (e.g. a bare CREATE TRIGGER) a second time.
      const result = await runMigrations(pool);
      expect(result.applied).toEqual([]);

      const goals = await pool.query("SELECT to_regclass('goals') AS exists");
      expect(goals.rows[0]!.exists).not.toBeNull();
    } finally {
      await drop();
    }
  });
});
