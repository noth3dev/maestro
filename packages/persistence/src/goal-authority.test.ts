import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, type GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";

const proof: GoalLeaseProof = { goalId: "goal-1", ownerId: "owner-1", fencingToken: "7" };

const openControlRow = {
  pause_requested_at: null,
  paused_at: null,
  stopping_at: null,
  stopped_at: null,
  emergency_stopped_at: null,
};

function fakePool(overrides: { leaseRowCount?: number; recheckRowCount?: number; goalState?: string } = {}): Pool & {
  statements: { sql: string; values: readonly unknown[] | undefined }[];
  client: { release: ReturnType<typeof vi.fn> };
} {
  const statements: { sql: string; values: readonly unknown[] | undefined }[] = [];
  const leaseRowCount = overrides.leaseRowCount ?? 1;
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    statements.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
    if (sql.startsWith("SELECT 1 FROM goal_leases")) {
      const count = statements.filter((entry) => entry.sql.startsWith("SELECT 1 FROM goal_leases")).length;
      // First lease read is the FOR UPDATE authority check, the second is the commit-time recheck.
      const rowCount = count === 1 ? leaseRowCount : (overrides.recheckRowCount ?? leaseRowCount);
      return { rowCount, rows: rowCount === 1 ? [1] : [] };
    }
    if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rowCount: 0, rows: [] };
    if (sql.startsWith("SELECT project_id, state FROM goals")) {
      return { rowCount: 1, rows: [{ project_id: "project-1", state: overrides.goalState ?? "active" }] };
    }
    if (sql.startsWith("INSERT INTO goal_controls")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("SELECT pause_requested_at")) return { rowCount: 1, rows: [{ ...openControlRow }] };
    if (sql === "SELECT 1") return { rowCount: 1, rows: [{ "?column?": 1 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient & { release: ReturnType<typeof vi.fn> };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool & {
    statements: { sql: string; values: readonly unknown[] | undefined }[];
    client: { release: ReturnType<typeof vi.fn> };
  };
  pool.statements = statements;
  pool.client = client;
  return pool;
}

function sqlOf(pool: { statements: { sql: string }[] }): string[] {
  return pool.statements.map((entry) => entry.sql);
}

describe("withGoalAuthority", () => {
  it("runs the effect between the authority check and COMMIT", async () => {
    const pool = fakePool();
    const seen: string[] = [];
    const result = await withGoalAuthority(pool, proof, 11, async (client) => {
      seen.push("effect");
      await client.query("SELECT 1");
      return "done";
    });
    expect(result).toBe("done");
    expect(seen).toEqual(["effect"]);
    const sql = sqlOf(pool);
    expect(sql).toContain("COMMIT");
    expect(sql).not.toContain("ROLLBACK");
    // Authority check -> effect -> commit-time recheck -> COMMIT, in order.
    const markers = ["BEGIN", "SELECT 1 FROM goal_leases", "SELECT 1", "SELECT 1 FROM goal_leases", "COMMIT"];
    const seenCounts = new Map<string, number>();
    const order = markers.map((marker) => {
      const occurrence = seenCounts.get(marker) ?? 0;
      seenCounts.set(marker, occurrence + 1);
      return sql.findIndex(
        (entry, index) =>
          (marker === "SELECT 1" ? entry === marker : entry.startsWith(marker)) &&
          sql.slice(0, index).filter((past) => (marker === "SELECT 1" ? past === marker : past.startsWith(marker))).length === occurrence,
      );
    });
    expect(order.every((index) => index !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The fencing proof is bound to both lease reads and the advisory lock.
    const leaseReads = pool.statements.filter((entry) => entry.sql.startsWith("SELECT 1 FROM goal_leases"));
    expect(leaseReads).toHaveLength(2);
    for (const read of leaseReads) expect(read.values).toEqual(["goal-1", "owner-1", "7"]);
    const advisory = pool.statements.find((entry) => entry.sql.startsWith("SELECT pg_advisory_xact_lock"));
    expect(advisory?.values).toEqual(["goal-1", 11]);
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  it("rejects structurally invalid proofs without touching the database", async () => {
    const pool = fakePool();
    await expect(withGoalAuthority(pool, { ...proof, goalId: "" }, 11, async () => "done")).rejects.toBeInstanceOf(StaleGoalLeaseError);
    await expect(withGoalAuthority(pool, { ...proof, ownerId: "" }, 11, async () => "done")).rejects.toBeInstanceOf(StaleGoalLeaseError);
    await expect(withGoalAuthority(pool, { ...proof, fencingToken: "0" }, 11, async () => "done")).rejects.toBeInstanceOf(
      StaleGoalLeaseError,
    );
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("rolls back when the lease is stale at entry", async () => {
    const pool = fakePool({ leaseRowCount: 0 });
    const effect = vi.fn(async () => "done");
    await expect(withGoalAuthority(pool, proof, 11, effect)).rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect(effect).not.toHaveBeenCalled();
    expect(sqlOf(pool)).toContain("ROLLBACK");
    expect(sqlOf(pool)).not.toContain("COMMIT");
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  it("refuses to commit when the lease expired during the effect", async () => {
    const pool = fakePool({ recheckRowCount: 0 });
    const effect = vi.fn(async () => "done");
    await expect(withGoalAuthority(pool, proof, 11, effect)).rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(sqlOf(pool)).toContain("ROLLBACK");
    expect(sqlOf(pool)).not.toContain("COMMIT");
  });

  it("propagates effect failures with rollback and release", async () => {
    const pool = fakePool();
    await expect(
      withGoalAuthority(pool, proof, 11, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(sqlOf(pool)).toContain("ROLLBACK");
    expect(sqlOf(pool)).not.toContain("COMMIT");
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });

  it("denies the effect while the Goal control latch is closed", async () => {
    const pool = fakePool({ goalState: "paused" });
    const effect = vi.fn(async () => "done");
    await expect(withGoalAuthority(pool, proof, 11, effect)).rejects.toThrow("Goal is paused");
    expect(effect).not.toHaveBeenCalled();
    expect(sqlOf(pool)).toContain("ROLLBACK");
    expect(sqlOf(pool)).not.toContain("COMMIT");
    expect(pool.client.release).toHaveBeenCalledTimes(1);
  });
});
