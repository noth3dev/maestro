import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

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

    for (const name of migrations) {
      await client.query(readFileSync(join(migrationsDirectory, name), "utf8"));
    }
  } finally {
    client.release();
  }
}
