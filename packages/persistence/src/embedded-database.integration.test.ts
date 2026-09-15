import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { startEmbeddedDatabase, type EmbeddedDatabaseHandle } from "./embedded-database.js";

const handles: EmbeddedDatabaseHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.stop();
});

describe("embedded PostgreSQL-compatible database", () => {
  it("applies every existing migration through the normal PostgreSQL wire protocol", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-db-"));
    try {
      const embedded = await startEmbeddedDatabase({ dataDir, port: 0 });
      handles.push(embedded);
      const pool = new Pool({ connectionString: embedded.databaseUrl, max: 1 });
      try {
        const result = await pool.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
        );
        expect(result.rows.map((row) => row.table_name)).toContain("goals");
        await expect(pool.query("SELECT gen_random_uuid()")).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await pool.end();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);


  it("preserves user data when the same embedded data directory restarts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "maestro-embedded-restart-"));
    let first: EmbeddedDatabaseHandle | undefined;
    let second: EmbeddedDatabaseHandle | undefined;
    try {
      first = await startEmbeddedDatabase({ dataDir, port: 0 });
      const writer = new Pool({ connectionString: first.databaseUrl, max: 1 });
      await writer.query("CREATE TABLE restart_probe (value text NOT NULL)");
      await writer.query("INSERT INTO restart_probe (value) VALUES ('survives')");
      await writer.end();
      await first.stop();
      first = undefined;

      second = await startEmbeddedDatabase({ dataDir, port: 0 });
      const reader = new Pool({ connectionString: second.databaseUrl, max: 1 });
      try {
        await expect(reader.query("SELECT value FROM restart_probe")).resolves.toMatchObject({ rows: [{ value: "survives" }] });
      } finally {
        await reader.end();
      }
    } finally {
      await first?.stop();
      await second?.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 120_000);
});
