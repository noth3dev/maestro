import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

/**
 * A fixed, arbitrary 64-bit advisory-lock key reserved for this migration
 * runner only. Any two processes calling pg_advisory_lock with this exact
 * key serialize against each other database-wide, regardless of schema.
 */
const MIGRATION_LOCK_KEY = 847_362_910_558_204_113n;

export class MigrationChecksumMismatchError extends Error {
  constructor(readonly filename: string) {
    super(`Migration file has changed since it was applied and recorded: ${filename}`);
    this.name = "MigrationChecksumMismatchError";
  }
}

export interface MigrationResult {
  /** Filenames actually applied during this call, in application order. Empty if already current. */
  applied: readonly string[];
}

export function computeMigrationChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export async function ensureMigrationLedgerTable(client: PoolClient): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text PRIMARY KEY,
       checksum text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
     )`,
  );
}

/**
 * Production-safe, additive-only migration runner. Unlike
 * test-migrations.ts's applyAllMigrations (test-only; unconditionally drops
 * and recreates the current schema before applying every migration), this
 * never drops anything: it applies only migrations not yet recorded in the
 * durable schema_migrations ledger, and fails closed if a previously
 * applied file's content no longer matches its recorded checksum (a
 * modified migration is a serious integrity problem, never silently
 * reapplied or ignored).
 *
 * A single pg_advisory_lock serializes concurrent callers (e.g. two control
 * plane instances starting at once) database-wide for the lock's duration,
 * so migrations are never applied twice concurrently; the lock is always
 * released, even on error.
 */
export async function runMigrations(pool: Pool): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY.toString()]);
    try {
      await ensureMigrationLedgerTable(client);

      const filenames = readdirSync(migrationsDirectory)
        .filter((name) => name.endsWith(".sql"))
        .sort();

      const recorded = await client.query<{ filename: string; checksum: string }>(
        "SELECT filename, checksum FROM schema_migrations",
      );
      const recordedByFilename = new Map(recorded.rows.map((row) => [row.filename, row.checksum]));

      const applied: string[] = [];
      for (const filename of filenames) {
        const sql = readFileSync(join(migrationsDirectory, filename), "utf8");
        const checksum = computeMigrationChecksum(sql);
        const existingChecksum = recordedByFilename.get(filename);
        if (existingChecksum !== undefined) {
          if (existingChecksum !== checksum) throw new MigrationChecksumMismatchError(filename);
          continue;
        }
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
            [filename, checksum],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
        applied.push(filename);
      }
      return { applied };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY.toString()]);
    }
  } finally {
    client.release();
  }
}
