import type { Pool, PoolClient } from "pg";

export interface DeviceAgentSession {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly identityFingerprint: string;
  readonly connectedAt: string;
  readonly lastSeenAt: string;
  readonly disconnectedAt: string | null;
  readonly state: "active" | "disconnected";
}

interface SessionRow { session_id: string; device_id: string; identity_fingerprint: string; connected_at: Date; last_seen_at: Date; disconnected_at: Date | null; state: "active" | "disconnected"; }
function map(row: SessionRow): DeviceAgentSession {
  return { sessionId: row.session_id, deviceId: row.device_id, identityFingerprint: row.identity_fingerprint.trim(), connectedAt: row.connected_at.toISOString(), lastSeenAt: row.last_seen_at.toISOString(), disconnectedAt: row.disconnected_at?.toISOString() ?? null, state: row.state };
}
const columns = "session_id, device_id, identity_fingerprint, connected_at, last_seen_at, disconnected_at, state";

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let open = false;
  try { await client.query("BEGIN"); open = true; const result = await operation(client); await client.query("COMMIT"); open = false; return result; }
  catch (error) { if (open) await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function openDeviceAgentSession(pool: Pool, sessionId: string, deviceId: string, identityFingerprint: string): Promise<DeviceAgentSession> {
  return transaction(pool, async (client) => {
    const result = await client.query<SessionRow>(`INSERT INTO device_agent_sessions (session_id, device_id, identity_fingerprint) VALUES ($1, $2, $3) RETURNING ${columns}`, [sessionId, deviceId, identityFingerprint]);
    return map(result.rows[0]!);
  });
}

export async function touchDeviceAgentSession(pool: Pool, sessionId: string): Promise<DeviceAgentSession> {
  return transaction(pool, async (client) => {
    const result = await client.query<SessionRow>(`UPDATE device_agent_sessions SET last_seen_at = clock_timestamp() WHERE session_id = $1 AND state = 'active' RETURNING ${columns}`, [sessionId]);
    if (result.rowCount !== 1) throw new Error("Device agent session is not active");
    return map(result.rows[0]!);
  });
}

export async function closeDeviceAgentSession(pool: Pool, sessionId: string): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query("UPDATE device_agent_sessions SET state = 'disconnected', disconnected_at = COALESCE(disconnected_at, clock_timestamp()), last_seen_at = clock_timestamp() WHERE session_id = $1 AND state = 'active'", [sessionId]);
  });
}

export async function readDeviceAgentSession(pool: Pick<Pool, "query">, sessionId: string): Promise<DeviceAgentSession | undefined> {
  const result = await pool.query<SessionRow>(`SELECT ${columns} FROM device_agent_sessions WHERE session_id = $1`, [sessionId]);
  return result.rowCount === 1 ? map(result.rows[0]!) : undefined;
}
