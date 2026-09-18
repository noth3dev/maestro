import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { ActualCostError, listActualCosts, recordActualCost } from "./actual-cost.js";
import type { GoalLeaseProof } from "./commands.js";

const proof: GoalLeaseProof = { goalId: "goal-1", ownerId: "owner-1", fencingToken: "7" };
const context = { actorId: "actor-1", sessionRef: "session-1", commandId: "command-1" };

const costRow = {
  cost_id: "cost-1",
  goal_id: "goal-1",
  command_id: "command-1",
  amount_cents: "2500",
  source: "provider",
  actor_id: "actor-1",
  session_ref: "session-1",
};

function fakePool(onEffectQuery: (sql: string) => { rowCount: number; rows: unknown[] }): Pool & {
  statements: string[];
} {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
    if (sql.startsWith("SELECT 1 FROM goal_leases")) return { rowCount: 1, rows: [1] };
    if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rowCount: 0, rows: [] };
    if (sql.startsWith("SELECT project_id, state FROM goals")) {
      return { rowCount: 1, rows: [{ project_id: "project-1", state: "active" }] };
    }
    if (sql.startsWith("INSERT INTO goal_controls")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("SELECT pause_requested_at")) {
      return {
        rowCount: 1,
        rows: [{ pause_requested_at: null, paused_at: null, stopping_at: null, stopped_at: null, emergency_stopped_at: null }],
      };
    }
    return onEffectQuery(sql);
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool & { statements: string[] };
  pool.statements = statements;
  return pool;
}

describe("recordActualCost", () => {
  it("rejects invalid input without touching the database", async () => {
    const pool = fakePool(() => ({ rowCount: 0, rows: [] }));
    await expect(recordActualCost(pool, "other-goal", 100, "provider", proof, context)).rejects.toBeInstanceOf(ActualCostError);
    await expect(recordActualCost(pool, "goal-1", -1, "provider", proof, context)).rejects.toBeInstanceOf(ActualCostError);
    await expect(recordActualCost(pool, "goal-1", 100, "   ", proof, context)).rejects.toBeInstanceOf(ActualCostError);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("records spend on first write", async () => {
    const pool = fakePool((sql) => {
      if (sql.startsWith("INSERT INTO goal_actual_costs")) return { rowCount: 1, rows: [{ ...costRow }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    await expect(recordActualCost(pool, "goal-1", 2500, "provider", proof, context)).resolves.toEqual({
      costId: "cost-1",
      goalId: "goal-1",
      commandId: "command-1",
      amountCents: 2500,
      source: "provider",
      actorId: "actor-1",
      sessionRef: "session-1",
    });
    expect(pool.statements).toContain("COMMIT");
  });

  it("replays an identical retry idempotently", async () => {
    const pool = fakePool((sql) => {
      if (sql.startsWith("INSERT INTO goal_actual_costs")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT cost_id")) return { rowCount: 1, rows: [{ ...costRow }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    await expect(recordActualCost(pool, "goal-1", 2500, "provider", proof, context)).resolves.toMatchObject({ costId: "cost-1" });
  });

  it("rejects a replayed command with different content", async () => {
    const pool = fakePool((sql) => {
      if (sql.startsWith("INSERT INTO goal_actual_costs")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("SELECT cost_id")) return { rowCount: 1, rows: [{ ...costRow, amount_cents: "9999" }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    await expect(recordActualCost(pool, "goal-1", 2500, "provider", proof, context)).rejects.toThrow("reused with different content");
  });

  it("fails when the idempotency record disappears", async () => {
    const pool = fakePool(() => ({ rowCount: 0, rows: [] }));
    await expect(recordActualCost(pool, "goal-1", 2500, "provider", proof, context)).rejects.toThrow("disappeared");
  });
});

describe("listActualCosts", () => {
  it("maps stored rows in recorded order", async () => {
    const pool = {
      query: vi.fn(async () => ({ rowCount: 2, rows: [{ ...costRow }, { ...costRow, cost_id: "cost-2", amount_cents: "100" }] })),
    } as unknown as Pool;
    await expect(listActualCosts(pool, "goal-1")).resolves.toEqual([
      expect.objectContaining({ costId: "cost-1", amountCents: 2500 }),
      expect.objectContaining({ costId: "cost-2", amountCents: 100 }),
    ]);
  });
});
