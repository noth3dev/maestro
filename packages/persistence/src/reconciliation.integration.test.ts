import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { acquireGoalLease, executeGoalCommand } from "./commands.js";
import {
  ReconcilerLeaseUnavailableError,
  acquireReconcilerLeaderLease,
  reconcileOnStartup,
  renewReconcilerLeaderLease,
} from "./reconciliation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Reconciliation leader lease and startup consistency scaffold", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function createGoal(state: string, projectId = randomUUID()) {
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "setup", leaseDurationMs: 60_000 });
    await executeGoalCommand(
      pool,
      { commandId: randomUUID(), projectId, goalId, actorId: "setup", type: "CreateGoal", expectedVersion: 0 },
      proof,
    );
    if (state !== "draft") {
      const path: Record<string, string[]> = {
        active: ["ready_for_confirmation", "launched", "active"],
        stopped: ["ready_for_confirmation", "launched", "active", "stopping", "stopped"],
        succeeded: ["ready_for_confirmation", "launched", "active", "certifying", "succeeded"],
      };
      let expectedVersion = 1;
      for (const to of path[state] ?? []) {
        const result = await executeGoalCommand(
          pool,
          { commandId: randomUUID(), projectId, goalId, actorId: "setup", type: "TransitionGoal", expectedVersion, to: to as never },
          proof,
        );
        if (result.outcome !== "succeeded") throw new Error(`setup transition failed: ${JSON.stringify(result)}`);
        expectedVersion = result.version!;
      }
    }
    // Let the setup goal_leases row expire so it doesn't itself look like a
    // dangling lease held across reconciliation.
    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    return { goalId, projectId };
  }

  beforeAll(async () => { await applyAllMigrations(pool); });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE reconciler_leader_lease, goal_controls, goal_leases, outbox, goal_events, goals, command_receipts RESTART IDENTITY CASCADE",
    );
  });

  afterAll(async () => { await pool.end(); });

  it("acquires an exact bigint fencing token for the singleton leader lease", async () => {
    await expect(acquireReconcilerLeaderLease(pool, "reconciler-a", 60_000)).resolves.toEqual({
      ownerId: "reconciler-a",
      fencingToken: "1",
    });
  });

  it("allows only one of two concurrent reconciler instances to acquire the leader lease", async () => {
    const attempts = await Promise.allSettled([
      acquireReconcilerLeaderLease(pool, "reconciler-a", 60_000),
      acquireReconcilerLeaderLease(pool, "reconciler-b", 60_000),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(ReconcilerLeaseUnavailableError) });
  });

  it("gives an expired leader lease successor a strictly higher exact bigint token", async () => {
    const first = await acquireReconcilerLeaderLease(pool, "reconciler-a", 1_000);
    await pool.query(
      "UPDATE reconciler_leader_lease SET fencing_token = 9007199254740992, expires_at = transaction_timestamp() - interval '1 millisecond' WHERE lease_key = 'singleton'",
    );
    await expect(acquireReconcilerLeaderLease(pool, "reconciler-b", 60_000)).resolves.toEqual({
      ownerId: "reconciler-b",
      fencingToken: "9007199254740993",
    });
    expect(first.fencingToken).toBe("1");
  });

  it("renews only a current matching leader lease proof and retains its token", async () => {
    const proof = await acquireReconcilerLeaderLease(pool, "reconciler-a", 1_000);
    await expect(renewReconcilerLeaderLease(pool, proof, 60_000)).resolves.toEqual(proof);
  });

  it("rejects renewal of a leader lease proof whose fencing token has moved on", async () => {
    const proof = await acquireReconcilerLeaderLease(pool, "reconciler-a", 1_000);
    await pool.query("UPDATE reconciler_leader_lease SET expires_at = transaction_timestamp() - interval '1 millisecond'");
    await acquireReconcilerLeaderLease(pool, "reconciler-b", 60_000);
    await expect(renewReconcilerLeaderLease(pool, proof, 60_000)).rejects.toThrow();
  });

  it("is safe to run with zero active Goals", async () => {
    const report = await reconcileOnStartup(pool, { ownerId: "reconciler-a" });
    expect(report.checkedGoalCount).toBe(0);
    expect(report.results).toEqual([]);
    expect(report.leaderProof).toEqual({ ownerId: "reconciler-a", fencingToken: "1" });
  });

  it("throws when the leader lease is already held by another instance", async () => {
    await acquireReconcilerLeaderLease(pool, "reconciler-a", 60_000);
    await expect(reconcileOnStartup(pool, { ownerId: "reconciler-b" })).rejects.toBeInstanceOf(ReconcilerLeaseUnavailableError);
  });

  it("leaves internally consistent nonterminal Goals untouched and never inspects terminal Goals", async () => {
    const { goalId: activeGoal } = await createGoal("active");
    await createGoal("stopped");
    await createGoal("succeeded");

    const report = await reconcileOnStartup(pool, { ownerId: "reconciler-a" });

    expect(report.checkedGoalCount).toBe(1);
    expect(report.results).toEqual([
      { goalId: activeGoal, projectId: expect.any(String), priorState: "active", outcome: "consistent", reasons: [], reconciledWorkerIds: [], reconciledHeadActivationCommandIds: [] },
    ]);
    const state = await pool.query("SELECT state FROM goals WHERE goal_id = $1", [activeGoal]);
    expect(state.rows[0]).toMatchObject({ state: "active" });
  });

  it("durably marks a Goal recovering when its emergency-stop control latch is inconsistent with its state", async () => {
    const { goalId, projectId } = await createGoal("active");
    await pool.query(
      `INSERT INTO goal_controls (project_id, goal_id, emergency_stopped_at) VALUES ($1, $2, transaction_timestamp())
       ON CONFLICT (project_id, goal_id) DO UPDATE SET emergency_stopped_at = EXCLUDED.emergency_stopped_at`,
      [projectId, goalId],
    );

    const report = await reconcileOnStartup(pool, { ownerId: "reconciler-a" });

    expect(report.results).toEqual([
      { goalId, projectId, priorState: "active", outcome: "recovering", reasons: ["emergency_stop_state_mismatch"], reconciledWorkerIds: [], reconciledHeadActivationCommandIds: [] },
    ]);
    const row = await pool.query("SELECT state, version FROM goals WHERE goal_id = $1", [goalId]);
    expect(row.rows[0]).toMatchObject({ state: "recovering" });
    const events = await pool.query("SELECT event_type FROM goal_events WHERE goal_id = $1 ORDER BY global_position", [goalId]);
    expect(events.rows.at(-1)).toMatchObject({ event_type: "GoalTransitioned" });
  });

  it("durably marks a Goal recovering when its goal lease is still held across a reconciliation restart", async () => {
    const { goalId, projectId } = await createGoal("active");
    await pool.query(
      `INSERT INTO goal_leases (goal_id, owner_id, fencing_token, expires_at)
       VALUES ($1, 'crashed-owner', 1, transaction_timestamp() + interval '1 hour')
       ON CONFLICT (goal_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, expires_at = EXCLUDED.expires_at`,
      [goalId],
    );

    const report = await reconcileOnStartup(pool, { ownerId: "reconciler-a" });

    expect(report.results).toEqual([
      { goalId, projectId, priorState: "active", outcome: "lease_contended", reasons: ["goal_lease_held_across_reconciliation"], reconciledWorkerIds: [], reconciledHeadActivationCommandIds: [] },
    ]);
    const row = await pool.query("SELECT state FROM goals WHERE goal_id = $1", [goalId]);
    expect(row.rows[0]).toMatchObject({ state: "active" });
  });

  it("only one of two concurrent reconciler instances mutates an inconsistent Goal, and it mutates exactly once", async () => {
    const { goalId, projectId } = await createGoal("active");
    await pool.query(
      `INSERT INTO goal_controls (project_id, goal_id, emergency_stopped_at) VALUES ($1, $2, transaction_timestamp())
       ON CONFLICT (project_id, goal_id) DO UPDATE SET emergency_stopped_at = EXCLUDED.emergency_stopped_at`,
      [projectId, goalId],
    );

    const attempts = await Promise.allSettled([
      reconcileOnStartup(pool, { ownerId: "reconciler-a" }),
      reconcileOnStartup(pool, { ownerId: "reconciler-b" }),
    ]);

    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: expect.any(ReconcilerLeaseUnavailableError) });

    const winningReport = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof reconcileOnStartup>>>).value;
    expect(winningReport.results).toEqual([
      { goalId, projectId, priorState: "active", outcome: "recovering", reasons: ["emergency_stop_state_mismatch"], reconciledWorkerIds: [], reconciledHeadActivationCommandIds: [] },
    ]);

    const events = await pool.query("SELECT event_type FROM goal_events WHERE goal_id = $1 ORDER BY global_position", [goalId]);
    // createGoal("active") appends 4 setup events (create + 3 transitions);
    // reconciliation must append exactly one more, never two.
    expect(events.rowCount).toBe(5);
    expect(events.rows.at(-1)).toMatchObject({ event_type: "GoalTransitioned" });
    const row = await pool.query("SELECT state, version FROM goals WHERE goal_id = $1", [goalId]);
    expect(row.rows[0]).toMatchObject({ state: "recovering", version: "5" });
  });
});
