import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { closeDeviceAgentSession, openDeviceAgentSession, readDeviceAgentSession, touchDeviceAgentSession } from "./device-session.js";

const row = {
  session_id: "session-1",
  device_id: "device-1",
  identity_fingerprint: "  abc123  ",
  connected_at: new Date("2026-01-01T00:00:00.000Z"),
  last_seen_at: new Date("2026-01-02T00:00:00.000Z"),
  disconnected_at: null,
  state: "active" as const,
};

function fakePool(onQuery: (sql: string) => { rowCount: number; rows: unknown[] }): Pool & {
  statements: string[];
  client: { release: ReturnType<typeof vi.fn> };
} {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    return onQuery(sql);
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient & { release: ReturnType<typeof vi.fn> };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool & {
    statements: string[];
    client: { release: ReturnType<typeof vi.fn> };
  };
  pool.statements = statements;
  pool.client = client;
  return pool;
}

describe("device-agent sessions", () => {
  it("opens a session and trims the identity fingerprint", async () => {
    const pool = fakePool(() => ({ rowCount: 1, rows: [{ ...row }] }));
    const session = await openDeviceAgentSession(pool, "session-1", "device-1", "  abc123  ");
    expect(session).toEqual({
      sessionId: "session-1",
      deviceId: "device-1",
      identityFingerprint: "abc123",
      connectedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-02T00:00:00.000Z",
      disconnectedAt: null,
      state: "active",
    });
    expect(pool.statements).toContain("COMMIT");
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  it("touches an active session and rejects a missing one", async () => {
    const pool = fakePool((sql) => (sql.startsWith("UPDATE") ? { rowCount: 1, rows: [{ ...row }] } : { rowCount: 0, rows: [] }));
    await expect(touchDeviceAgentSession(pool, "session-1")).resolves.toMatchObject({ sessionId: "session-1" });
    const missing = fakePool(() => ({ rowCount: 0, rows: [] }));
    await expect(touchDeviceAgentSession(missing, "gone")).rejects.toThrow("Device agent session is not active");
  });

  it("closes a session without failing on an already-closed one", async () => {
    const pool = fakePool(() => ({ rowCount: 0, rows: [] }));
    await expect(closeDeviceAgentSession(pool, "session-1")).resolves.toBeUndefined();
    expect(pool.statements.some((sql) => sql.includes("state = 'disconnected'"))).toBe(true);
    expect(pool.statements).toContain("COMMIT");
  });

  it("rolls back and releases when the operation fails", async () => {
    const pool = fakePool((sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      throw new Error("boom");
    });
    await expect(openDeviceAgentSession(pool, "session-1", "device-1", "abc")).rejects.toThrow("boom");
    expect(pool.statements).toContain("ROLLBACK");
    expect(pool.statements).not.toContain("COMMIT");
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  it("reads a session or returns undefined", async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [{ ...row }] })) } as unknown as Pool;
    await expect(readDeviceAgentSession(pool, "session-1")).resolves.toMatchObject({ identityFingerprint: "abc123" });
    const empty = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })) } as unknown as Pool;
    await expect(readDeviceAgentSession(empty, "gone")).resolves.toBeUndefined();
  });
});
