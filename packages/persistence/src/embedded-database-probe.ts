import { Pool, type PoolClient } from "pg";

export async function probeEmbeddedDatabase(databaseUrl: string, timeoutMs: number): Promise<boolean> {
  const timeout = Math.max(1, Math.floor(timeoutMs));
  const deadline = Date.now() + timeout;
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: timeout });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    const query = { text: "SELECT 1", query_timeout: remaining };
    await client.query(query);
    return true;
  } catch {
    return false;
  } finally {
    if (client !== undefined) {
      // This one-shot probe must not wait for PostgreSQL to complete graceful shutdown.
      const connection = (client as unknown as { connection: { stream: { destroy: () => void } } }).connection;
      connection.stream.destroy();
      client.release(true);
    }
    await pool.end().catch(() => undefined);
  }
}
