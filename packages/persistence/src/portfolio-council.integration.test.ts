import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES, type PortfolioCouncilInput, type PortfolioGoalInput, decidePortfolioCouncil, declareTaskDemand, type ModelCapabilityVector } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { listPortfolioCouncilDecisions, readPortfolioCouncilDecision, recordPortfolioCouncilDecision } from "./portfolio-council.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const uuid = () => randomUUID();

function demand() {
  return declareTaskDemand({
    taskKinds: ["coding"], taskContractRef: "contract:portfolio", headDecisionRef: "head:portfolio",
    requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head-approved requirement" }])),
  });
}
function capability(): ModelCapabilityVector {
  return { schemaVersion: 2, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score: 100, rationale: "evidence", evidence: ["evidence:model"] }])) as ModelCapabilityVector["axes"] };
}
function input(projectId: string, goalId: string): PortfolioCouncilInput {
  const goal: PortfolioGoalInput = {
    goalId, projectId, priority: 1, ceoPinned: false, pressure: 120, taskDemand: demand(),
    currentRouting: { modelRef: "provider/model-a", capability: capability() },
    approvedCeiling: { providerRate: 2, spendCents: 100, workerSlots: 1 },
    currentAllocation: { providerRate: 1, spendCents: 20, workerSlots: 1 }, safePausePoint: "after-test-boundary",
  };
  return {
    councilId: uuid(), commandId: uuid(), trigger: "capacity_conflict", goals: [goal],
    actions: [{ goalId, disposition: "pause", order: 0, allocation: { providerRate: 0, spendCents: 0, workerSlots: 0 }, rationale: "reallocate at safe point", executionFence: { previousExecutionRef: "exec-old", previousFencingToken: "7", nextFencingToken: "8" } }],
    evidenceReferences: ["evidence:capacity"], dissent: ["Head requested one more validation pass"], confidence: 0.75, reconsiderationTriggers: ["worker slot released"],
  };
}

describeDatabase("Portfolio Council persistence", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => { await applyAllMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("records an evidence-backed decision and its execution fence durably", async () => {
    const projectId = uuid();
    const goalId = uuid();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    const decision = decidePortfolioCouncil(input(projectId, goalId));
    const recorded = await recordPortfolioCouncilDecision(pool, { projectId, decision, actorId: "concertmaster", sessionRef: "session:portfolio" });
    expect(recorded.status).toBe("decided");
    expect(recorded.projectId).toBe(projectId);
    expect(recorded.actions[0]!.executionFence?.previousExecutionRef).toBe("exec-old");
    const fence = await pool.query<{ previous_execution_ref: string; previous_fencing_token: string; next_fencing_token: string }>("SELECT previous_execution_ref, previous_fencing_token, next_fencing_token FROM portfolio_execution_fences WHERE round_id = $1", [recorded.roundId]);
    expect(fence.rows).toEqual([{ previous_execution_ref: "exec-old", previous_fencing_token: "7", next_fencing_token: "8" }]);
  });

  it("replays the same command without a second round and keeps decisions append-only", async () => {
    const projectId = uuid();
    const goalId = uuid();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    const original = input(projectId, goalId);
    const decision = decidePortfolioCouncil(original);
    const first = await recordPortfolioCouncilDecision(pool, { projectId, decision, actorId: "concertmaster", sessionRef: "session:portfolio" });
    const replay = await recordPortfolioCouncilDecision(pool, { projectId, decision, actorId: "concertmaster", sessionRef: "session:portfolio" });
    expect(replay.roundId).toBe(first.roundId);
    expect(await listPortfolioCouncilDecisions(pool, decision.councilId)).toHaveLength(1);
    await expect(pool.query("UPDATE portfolio_council_rounds SET confidence = 0.1 WHERE round_id = $1", [first.roundId])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM portfolio_council_rounds WHERE round_id = $1", [first.roundId])).rejects.toThrow(/append-only/);
    const changed = { ...decision, confidence: 0.9 };
    await expect(recordPortfolioCouncilDecision(pool, { projectId, decision: changed, actorId: "concertmaster", sessionRef: "session:portfolio" })).rejects.toThrow(/reused/);
    expect((await readPortfolioCouncilDecision(pool, first.roundId)).contentHash).toBe(first.contentHash);
  });

  it("rejects a decision whose Goal is outside the project boundary", async () => {
    const projectId = uuid();
    const otherProjectId = uuid();
    const goalId = uuid();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, otherProjectId]);
    const decision = decidePortfolioCouncil(input(projectId, goalId));
    await expect(recordPortfolioCouncilDecision(pool, { projectId, decision, actorId: "concertmaster", sessionRef: "session:portfolio" })).rejects.toThrow(/project/);
  });
});
