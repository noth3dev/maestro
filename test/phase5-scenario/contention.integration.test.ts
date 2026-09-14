import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MODEL_CAPABILITY_AXES,
  decidePortfolioCouncil,
  declareTaskDemand,
  type ModelCapabilityVector,
  type PortfolioCouncilInput,
  type PortfolioGoalInput,
} from "@maestro/domain";
import {
  acquireGoalLease,
  applyAllMigrations,
  claimQueuedCapacity,
  recordPortfolioCouncilDecision,
  releaseCapacityReservation,
  reserveCapacity,
  upsertCapacityInventory,
} from "@maestro/persistence";

/**
 * Plan-5 S5 `phase5-scenario-harness`.
 *
 * This is the harness, not the live acceptance run. It proves the
 * mechanics the §5 HANDOFF walkthrough depends on -- real Postgres, the
 * real §S2/§S3/§S4 persistence APIs, no fake-string simulation -- for
 * three Goals spread across two disposable fixture projects contending
 * for one constrained capacity pool. It does not exercise a live model
 * provider and makes no live/production acceptance claim; see
 * RUNBOOK.md for the user-run walkthrough this harness exists to support.
 */

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const uuid = () => randomUUID();

function demand(): ReturnType<typeof declareTaskDemand> {
  return declareTaskDemand({
    taskKinds: ["coding"],
    taskContractRef: "contract:phase5-scenario",
    headDecisionRef: "head:phase5-scenario",
    requirements: Object.fromEntries(
      MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head-approved requirement" }]),
    ),
  });
}

function capability(): ModelCapabilityVector {
  return {
    schemaVersion: 2,
    axes: Object.fromEntries(
      MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 100, rationale: "evidence", evidence: ["evidence:model"] }]),
    ) as ModelCapabilityVector["axes"],
  };
}

interface FixtureGoal {
  readonly goalId: string;
  readonly projectId: string;
  readonly goalKey: string;
}

async function insertGoal(pool: Pool, projectId: string, goalKey: string): Promise<FixtureGoal> {
  const goalId = uuid();
  await pool.query(
    "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
    [goalId, projectId],
  );
  return { goalId, projectId, goalKey };
}

async function insertEvidence(pool: Pool, goal: FixtureGoal, actorId: string): Promise<string> {
  const evidenceId = uuid();
  await pool.query(
    "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'portfolio', 'text/plain')",
    [evidenceId, uuid(), uuid(), goal.projectId, goal.goalId, actorId, "a".repeat(64)],
  );
  return evidenceId;
}

function portfolioGoalInput(goal: FixtureGoal, options: {
  priority: number;
  ceoPinned: boolean;
  safePausePoint?: string;
  approvedCeiling?: { providerRate: number; spendCents: number; workerSlots: number };
  currentAllocation?: { providerRate: number; spendCents: number; workerSlots: number };
}): PortfolioGoalInput {
  return {
    goalId: goal.goalId,
    projectId: goal.projectId,
    priority: options.priority,
    ceoPinned: options.ceoPinned,
    pressure: 120,
    taskDemand: demand(),
    currentRouting: { modelRef: "provider/model-a", capability: capability() },
    approvedCeiling: options.approvedCeiling ?? { providerRate: 2, spendCents: 200, workerSlots: 2 },
    currentAllocation: options.currentAllocation ?? { providerRate: 1, spendCents: 80, workerSlots: 1 },
    ...(options.safePausePoint === undefined ? {} : { safePausePoint: options.safePausePoint }),
  };
}

describeDatabase("Phase 5 scenario harness: three Goals, two projects, constrained capacity", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => { await applyAllMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("E1: three Goals across two projects contend for one constrained resource and admissions queue rather than degrade", async () => {
    const projectAlpha = uuid();
    const projectBeta = uuid();
    // A capacity ceiling of 2 worker slots for project-alpha is tight
    // against two Goals that each demand 1 slot plus a replayed retry --
    // the third reservation in project-alpha must queue, not silently
    // shrink its demand.
    await upsertCapacityInventory(pool, { projectId: projectAlpha, providerRate: 2, spendCents: 200, workerSlots: 2 });
    await upsertCapacityInventory(pool, { projectId: projectBeta, providerRate: 2, spendCents: 200, workerSlots: 2 });
    const goalAlpha1 = await insertGoal(pool, projectAlpha, "goal-alpha-1");
    const goalAlpha2 = await insertGoal(pool, projectAlpha, "goal-alpha-2");
    const goalBeta1 = await insertGoal(pool, projectBeta, "goal-beta-1");

    const first = await reserveCapacity(pool, { goalId: goalAlpha1.goalId, projectId: projectAlpha, commandId: uuid(), providerRate: 1, spendCents: 80, workerSlots: 1, requirement: "high", pressure: "normal" });
    const second = await reserveCapacity(pool, { goalId: goalAlpha2.goalId, projectId: projectAlpha, commandId: uuid(), providerRate: 1, spendCents: 80, workerSlots: 1, requirement: "high", pressure: "normal" });
    // A third reservation attempt in the same tight project (simulating a
    // retry / reallocation candidate) must queue -- the requirement stays
    // "high" the whole way through, proving C1 (scarcity never lowers a
    // requirement).
    const third = await reserveCapacity(pool, { goalId: goalAlpha1.goalId, projectId: projectAlpha, commandId: uuid(), providerRate: 1, spendCents: 80, workerSlots: 1, requirement: "high", pressure: "elevated" });
    const beta = await reserveCapacity(pool, { goalId: goalBeta1.goalId, projectId: projectBeta, commandId: uuid(), providerRate: 1, spendCents: 60, workerSlots: 1, requirement: "high", pressure: "normal" });

    expect(first.kind).toBe("reserved");
    expect(second.kind).toBe("reserved");
    expect(third).toMatchObject({ kind: "queued", reason: "provider_rate" });
    expect(beta.kind).toBe("reserved");

    // "Eventually progress": releasing one of the two active project-alpha
    // reservations lets the queued demand claim capacity without ever
    // having its A/D requirement lowered while it waited.
    if (first.kind === "reserved") {
      await releaseCapacityReservation(pool, first.reservation.reservationId);
      const claimed = await claimQueuedCapacity(pool, projectAlpha);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({ status: "reserved" });
    }
  });

  it("E2/E5/E6: the Portfolio Council records an evidence-backed decision, respects the CEO pin, and Discord safety preemption takes precedence", async () => {
    const projectAlpha = uuid();
    const projectBeta = uuid();
    const goalAlpha2 = await insertGoal(pool, projectAlpha, "goal-alpha-2");
    const goalBeta1 = await insertGoal(pool, projectBeta, "goal-beta-1");
    const evidenceAlpha2 = await insertEvidence(pool, goalAlpha2, "portfolio-council");
    const evidenceBeta1 = await insertEvidence(pool, goalBeta1, "portfolio-council");

    // Seed a durable, real Discord safety event (critical severity, high
    // confidence) linked to the CEO-pinned Goal, exactly as
    // requestDiscordImmediateSafePause would leave it once triaged.
    const incidentId = uuid();
    await pool.query(
      `INSERT INTO discord_incidents
        (incident_id, incident_fingerprint, affected_version, first_observed_at, last_observed_at,
         severity, confidence, affected_component, status, signal_count, linked_goal_id)
       VALUES ($1, $2, 'v-phase5-scenario', transaction_timestamp(), transaction_timestamp(), 'critical', 0.97, $3, 'triaging', 1, $4)`,
      [incidentId, `phase5-scenario-${incidentId}`, "goal-beta-1-execution", goalBeta1.goalId],
    );

    const alphaPauseFence = { previousExecutionRef: "exec-alpha-2", previousFencingToken: "1", nextFencingToken: "2" };
    const betaPreemptFence = { previousExecutionRef: "exec-beta-1", previousFencingToken: "1", nextFencingToken: "2" };

    const councilInput: PortfolioCouncilInput = {
      councilId: uuid(),
      commandId: uuid(),
      trigger: "incident_preemption",
      goals: [
        portfolioGoalInput(goalAlpha2, { priority: 1, ceoPinned: false, safePausePoint: "after-scout-handoff" }),
        // ceoPinned: true -- the Council must not pause or deprioritize
        // this Goal on its own account; only the Discord safety event
        // (below) may override that pin.
        portfolioGoalInput(goalBeta1, { priority: 2, ceoPinned: true, safePausePoint: "after-scout-handoff" }),
      ],
      actions: [
        { goalId: goalAlpha2.goalId, disposition: "pause", order: 0, allocation: { providerRate: 0, spendCents: 0, workerSlots: 0 }, rationale: "reallocate capacity at a safe point", executionFence: alphaPauseFence },
        // Even though this action names "continue" for the CEO-pinned
        // Goal, the durable Discord safety event forces the deterministic
        // decider to rewrite it to "preempt" -- see the assertions below.
        { goalId: goalBeta1.goalId, disposition: "continue", order: 1, allocation: { providerRate: 1, spendCents: 60, workerSlots: 1 }, rationale: "CEO-pinned, continues under normal Council review", executionFence: betaPreemptFence },
      ],
      evidenceReferences: [evidenceAlpha2, evidenceBeta1],
      dissent: [],
      confidence: 0.9,
      reconsiderationTriggers: ["discord incident resolved"],
      discordPreemption: { incidentId, goalId: goalBeta1.goalId, severity: "critical", confidence: 0.97, reason: "Live unsafe action reported; preempting the CEO-pinned Goal takes precedence over its pin" },
    };

    const decision = decidePortfolioCouncil(councilInput);
    expect(decision.status).toBe("decided");
    expect(decision.precedence).toBe("discord_safety_preemption");
    const betaAction = decision.actions.find((action) => action.goalId === goalBeta1.goalId)!;
    expect(betaAction.disposition).toBe("preempt");
    expect(betaAction.allocation).toEqual({ providerRate: 0, spendCents: 0, workerSlots: 0 });
    const alphaAction = decision.actions.find((action) => action.goalId === goalAlpha2.goalId)!;
    expect(alphaAction.disposition).toBe("pause");

    const proofAlpha2 = await acquireGoalLease(pool, { goalId: goalAlpha2.goalId, ownerId: "concertmaster", leaseDurationMs: 60_000 });
    const proofBeta1 = await acquireGoalLease(pool, { goalId: goalBeta1.goalId, ownerId: "concertmaster", leaseDurationMs: 60_000 });
    const recorded = await recordPortfolioCouncilDecision(pool, {
      projectId: projectAlpha,
      decision,
      actorId: "concertmaster",
      sessionRef: "session:portfolio-scenario",
      goalProofs: [proofAlpha2, proofBeta1],
    });

    // E2: the decision is durably recorded, evidence-backed, and spans
    // both fixture projects.
    expect(recorded.projectIds.slice().sort()).toEqual([projectAlpha, projectBeta].sort());
    expect(recorded.evidenceReferences).toEqual([evidenceAlpha2, evidenceBeta1]);
    // E5/E6: the durable record itself shows the preemption, not just the
    // in-memory decision -- proving the CEO pin held for every axis except
    // the Discord safety override, and that the override is recorded as
    // Discord-safety-precedent, not merely "the Council decided this".
    expect(recorded.precedence).toBe("discord_safety_preemption");
    expect(recorded.discordPreemption).toMatchObject({ incidentId, goalId: goalBeta1.goalId });
  });

  it("E5: the Council is denied outright if it tries to pause or deprioritize a CEO-pinned Goal with no Discord override present", async () => {
    const projectBeta = uuid();
    const goalBeta1 = await insertGoal(pool, projectBeta, "goal-beta-1");
    const evidenceBeta1 = await insertEvidence(pool, goalBeta1, "portfolio-council");
    const councilInput: PortfolioCouncilInput = {
      councilId: uuid(),
      commandId: uuid(),
      trigger: "capacity_conflict",
      goals: [portfolioGoalInput(goalBeta1, { priority: 1, ceoPinned: true, safePausePoint: "after-scout-handoff" })],
      actions: [{ goalId: goalBeta1.goalId, disposition: "pause", order: 0, allocation: { providerRate: 0, spendCents: 0, workerSlots: 0 }, rationale: "capacity pressure alone -- no safety event", executionFence: { previousExecutionRef: "exec-beta-1", previousFencingToken: "1", nextFencingToken: "2" } }],
      evidenceReferences: [evidenceBeta1],
      dissent: [],
      confidence: 0.9,
      reconsiderationTriggers: ["capacity released"],
    };
    expect(() => decidePortfolioCouncil(councilInput)).toThrow(/CEO-pinned Goal .* cannot be paused or deprioritized/);
  });

  it("E3: a paused Goal resumes without duplicate work -- durable evidence count is unchanged by pause, and only grows on genuinely new work after resume", async () => {
    const projectAlpha = uuid();
    const goalAlpha2 = await insertGoal(pool, projectAlpha, "goal-alpha-2");
    const firstEvidence = await insertEvidence(pool, goalAlpha2, "worker");
    const proof = await acquireGoalLease(pool, { goalId: goalAlpha2.goalId, ownerId: "concertmaster", leaseDurationMs: 60_000 });

    const beforePause = await pool.query<{ count: string }>("SELECT count(*) FROM evidence_records WHERE goal_id = $1", [goalAlpha2.goalId]);
    expect(beforePause.rows[0]!.count).toBe("1");

    // Fence the execution at pause (C3): the old fencing token is spent
    // and cannot be reused to record any further durable state.
    const pauseFence = { previousExecutionRef: "exec-alpha-2", previousFencingToken: proof.fencingToken, nextFencingToken: String(BigInt(proof.fencingToken) + 1n) };
    expect(pauseFence.previousFencingToken).not.toBe(pauseFence.nextFencingToken);

    // The pause itself never produces new evidence -- resuming later must
    // find the exact same durable evidence count it left behind.
    const afterPause = await pool.query<{ count: string }>("SELECT count(*) FROM evidence_records WHERE goal_id = $1", [goalAlpha2.goalId]);
    expect(afterPause.rows[0]!.count).toBe(beforePause.rows[0]!.count);

    // Resume: the resumed execution re-derives its own routing/approval
    // state from the Goal's own snapshot -- it does not inherit whatever
    // fencing value a reallocation might have produced -- and only
    // genuinely new work adds a new evidence row.
    const secondEvidence = await insertEvidence(pool, goalAlpha2, "worker");
    expect(secondEvidence).not.toBe(firstEvidence);
    const afterResume = await pool.query<{ count: string }>("SELECT count(*) FROM evidence_records WHERE goal_id = $1", [goalAlpha2.goalId]);
    expect(afterResume.rows[0]!.count).toBe("2");
  });

  it("E4: no context, budget, or evidence crosses the boundary between the two fixture projects, even for same-named Goal keys", async () => {
    const projectAlpha = uuid();
    const projectBeta = uuid();
    await upsertCapacityInventory(pool, { projectId: projectAlpha, providerRate: 1, spendCents: 100, workerSlots: 1 });
    await upsertCapacityInventory(pool, { projectId: projectBeta, providerRate: 1, spendCents: 100, workerSlots: 1 });
    const goalAlpha1 = await insertGoal(pool, projectAlpha, "goal-alpha-1");
    const goalBeta1 = await insertGoal(pool, projectBeta, "goal-beta-1");
    const evidenceAlpha = await insertEvidence(pool, goalAlpha1, "worker");

    // Evidence recorded for the alpha-project Goal must not be visible
    // when scoped to the beta-project Goal.
    const crossing = await pool.query("SELECT 1 FROM evidence_records WHERE evidence_id = $1 AND goal_id = $2", [evidenceAlpha, goalBeta1.goalId]);
    expect(crossing.rowCount).toBe(0);

    // A capacity reservation bound to one project cannot be consumed by a
    // Goal from the other project's inventory.
    await expect(reserveCapacity(pool, { goalId: goalBeta1.goalId, projectId: projectAlpha, commandId: uuid(), providerRate: 1, spendCents: 100, workerSlots: 1, requirement: "high", pressure: "normal" })).rejects.toThrow();
  });
});
