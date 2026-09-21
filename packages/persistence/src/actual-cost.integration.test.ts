import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease, StaleGoalLeaseError } from "./commands.js";
import { ActualCostError, listActualCosts, recordActualCost } from "./actual-cost.js";

/**
 * Plan-5 §1 noted `actual-cost.ts` had no integration test against real
 * PostgreSQL, only the mocked-pool unit suite in `actual-cost.test.ts`.
 * This closes that gap: real migrations, a real Goal lease, and the
 * immutability/idempotency triggers `0038_goal_actual_costs.sql` declares.
 */

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });

describeDatabase("Actual cost recording with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => { await applyAllMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  async function seedGoal(): Promise<{ goalId: string; projectId: string }> {
    const goalId = randomUUID();
    const projectId = randomUUID();
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId],
    );
    return { goalId, projectId };
  }

  it("records incurred spend and lists it back in recorded order", async () => {
    const { goalId } = await seedGoal();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const first = await recordActualCost(pool, goalId, 2_500, "provider", proof, context("worker-1"));
    expect(first.amountCents).toBe(2_500);
    const second = await recordActualCost(pool, goalId, 100, "provider", proof, context("worker-2"));
    const listed = await listActualCosts(pool, goalId);
    expect(listed.map((cost) => cost.costId)).toEqual([first.costId, second.costId]);
  });

  it("replays an identical retry idempotently without inserting a second row", async () => {
    const { goalId } = await seedGoal();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const ctx = context("worker-1");
    const first = await recordActualCost(pool, goalId, 2_500, "provider", proof, ctx);
    const replay = await recordActualCost(pool, goalId, 2_500, "provider", proof, ctx);
    expect(replay).toEqual(first);
    expect(await listActualCosts(pool, goalId)).toHaveLength(1);
  });

  it("rejects a replayed command id reused with different content", async () => {
    const { goalId } = await seedGoal();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const ctx = context("worker-1");
    await recordActualCost(pool, goalId, 2_500, "provider", proof, ctx);
    await expect(recordActualCost(pool, goalId, 9_999, "provider", proof, ctx)).rejects.toThrow(/reused with different content/);
    expect(await listActualCosts(pool, goalId)).toHaveLength(1);
  });

  it("rejects every write under a stale fencing token and leaves the ledger unchanged", async () => {
    const { goalId } = await seedGoal();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const forgedProof = { goalId, ownerId: proof.ownerId, fencingToken: String(BigInt(proof.fencingToken) + 1n) };
    await expect(recordActualCost(pool, goalId, 2_500, "provider", forgedProof, context("worker-1"))).rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect(await listActualCosts(pool, goalId)).toHaveLength(0);
  });

  it("is immutable once recorded: direct UPDATE and DELETE are rejected by the durable trigger", async () => {
    const { goalId } = await seedGoal();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const cost = await recordActualCost(pool, goalId, 2_500, "provider", proof, context("worker-1"));
    await expect(pool.query("UPDATE goal_actual_costs SET amount_cents = 1 WHERE cost_id = $1", [cost.costId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM goal_actual_costs WHERE cost_id = $1", [cost.costId])).rejects.toThrow();
  });

  it("keeps actual costs scoped to their own Goal: a second Goal's ledger stays empty", async () => {
    const { goalId: goalA } = await seedGoal();
    const { goalId: goalB } = await seedGoal();
    const proofA = await acquireGoalLease(pool, { goalId: goalA, ownerId: "test", leaseDurationMs: 60_000 });
    await recordActualCost(pool, goalA, 2_500, "provider", proofA, context("worker-1"));
    expect(await listActualCosts(pool, goalB)).toHaveLength(0);
    await expect(recordActualCost(pool, goalA, 2_500, "provider", { ...proofA, goalId: goalB }, context("worker-1"))).rejects.toBeInstanceOf(ActualCostError);
  });
});
