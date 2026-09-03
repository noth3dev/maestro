import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { computeMigrationChecksum, ensureMigrationLedgerTable } from "./migrate.js";

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function applyAllMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ schema_name: string | null }>("SELECT current_schema() AS schema_name");
    const schemaName = rows[0]?.schema_name;
    if (!schemaName) throw new Error("Migration runner requires an existing schema in search_path");

    // Reset the schema selected by this connection. A fixed public-schema reset
    // leaves per-test schemas untouched when search_path is scoped.
    const schema = quoteIdentifier(schemaName);
    await client.query(`DROP SCHEMA ${schema} CASCADE; CREATE SCHEMA ${schema}`);

    const migrations = readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    // Also populate the production runner's ledger (schema_migrations) with
    // every applied file's checksum, so a real control-plane process's
    // subsequent runMigrations(pool) call -- e.g. inside a real-DB
    // integration test that also exercises createControlPlane().listen()
    // against this same test-built schema -- sees every migration already
    // current instead of re-executing non-idempotent DDL a second time.
    await ensureMigrationLedgerTable(client);
    for (const name of migrations) {
      const sql = readFileSync(join(migrationsDirectory, name), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
        [name, computeMigrationChecksum(sql)],
      );
    }
  } finally {
    client.release();
  }
}
