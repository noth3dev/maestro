import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES, type PortfolioCouncilInput, type PortfolioGoalInput, decidePortfolioCouncil, declareTaskDemand, type ModelCapabilityVector } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease } from "./commands.js";
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
function input(projectId: string, goalId: string, previousFencingToken = "1", evidenceId = "00000000-0000-0000-0000-000000000001"): PortfolioCouncilInput {
  const goal: PortfolioGoalInput = {
    goalId, projectId, priority: 1, ceoPinned: false, pressure: 120, taskDemand: demand(),
    currentRouting: { modelRef: "provider/model-a", capability: capability() },
    approvedCeiling: { providerRate: 2, spendCents: 100, workerSlots: 1 },
    currentAllocation: { providerRate: 1, spendCents: 20, workerSlots: 1 }, safePausePoint: "after-test-boundary",
  };
  return {
    councilId: uuid(), commandId: uuid(), trigger: "capacity_conflict", goals: [goal],
    actions: [{ goalId, disposition: "pause", order: 0, allocation: { providerRate: 0, spendCents: 0, workerSlots: 0 }, rationale: "reallocate at safe point", executionFence: { previousExecutionRef: "exec-old", previousFencingToken, nextFencingToken: String(Number(previousFencingToken) + 1) } }],
    evidenceReferences: [evidenceId], dissent: ["Head requested one more validation pass"], confidence: 0.75, reconsiderationTriggers: ["worker slot released"],
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
    const evidenceId = uuid();
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'portfolio', 'text/plain')", [evidenceId, uuid(), uuid(), projectId, goalId, "concertmaster", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    const decision = decidePortfolioCouncil(input(projectId, goalId, "1", evidenceId));
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "concertmaster", leaseDurationMs: 60_000 });
    const recorded = await recordPortfolioCouncilDecision(pool, { projectId, decision, actorId: "concertmaster", sessionRef: "session:portfolio", goalProofs: [proof] });
    expect(recorded.status).toBe("decided");
    expect(recorded.projectId).toBe(projectId);
    expect(recorded.actions[0]!.executionFence?.previousExecutionRef).toBe("exec-old");
    const fence = await pool.query<{ previous_execution_ref: string; previous_fencing_token: string; next_fencing_token: string }>("SELECT previous_execution_ref, previous_fencing_token, next_fencing_token FROM portfolio_execution_fences WHERE round_id = $1", [recorded.roundId]);
    expect(fence.rows).toEqual([{ previous_execution_ref: "exec-old", previous_fencing_token: "1", next_fencing_token: "2" }]);
    await expect(pool.query(
      `INSERT INTO portfolio_council_rounds
       (round_id, project_id, project_ids, council_id, command_id, trigger, status, execution_disposition, precedence, confidence, decision, content_hash, actor_id, session_ref)
       VALUES ($1, $2, $3::uuid[], $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)`,
      [uuid(), projectId, [projectId], decision.councilId, decision.commandId, decision.trigger, decision.status, decision.executionDisposition, decision.precedence, decision.confidence, JSON.stringify(decision), "f".repeat(64), "concertmaster", "session:portfolio"],
    )).rejects.toThrow(/content hash/);
  });

  it("replays the same command without a second round and keeps decisions append-only", async () => {
    const projectId = uuid();
    const goalId = uuid();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    const evidenceId = uuid();
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'portfolio', 'text/plain')", [evidenceId, uuid(), uuid(), projectId, goalId, "concertmaster", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    const original = input(projectId, goalId, "1", evidenceId);
    const decision = decidePortfolioCouncil(original);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "concertmaster", leaseDurationMs: 60_000 });
    const recordInput = { projectId, decision, actorId: "concertmaster", sessionRef: "session:portfolio", goalProofs: [proof] };
    const first = await recordPortfolioCouncilDecision(pool, recordInput);
    const replay = await recordPortfolioCouncilDecision(pool, recordInput);
    expect(replay.roundId).toBe(first.roundId);
    expect(await listPortfolioCouncilDecisions(pool, decision.councilId)).toHaveLength(1);
    await expect(pool.query("UPDATE portfolio_council_rounds SET confidence = 0.1 WHERE round_id = $1", [first.roundId])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM portfolio_council_rounds WHERE round_id = $1", [first.roundId])).rejects.toThrow(/append-only/);
    await expect(pool.query("TRUNCATE portfolio_council_rounds CASCADE")).rejects.toThrow(/append-only/);
    await expect(pool.query("TRUNCATE portfolio_execution_fences")).rejects.toThrow(/append-only/);
    const changed = { ...decision, confidence: 0.9 };
    await expect(recordPortfolioCouncilDecision(pool, { ...recordInput, decision: changed })).rejects.toThrow(/invalid|reused/);
    expect((await readPortfolioCouncilDecision(pool, first.roundId)).contentHash).toBe(first.contentHash);
  });

  it("persists one cross-project portfolio round with every Goal lease and evidence binding", async () => {
    const projectA = uuid();
    const projectB = uuid();
    const goalA = uuid();
    const goalB = uuid();
    const evidenceA = uuid();
    const evidenceB = uuid();
    for (const [goalId, projectId, evidenceId] of [[goalA, projectA, evidenceA], [goalB, projectB, evidenceB]] as const) {
      await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
      await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'portfolio', 'text/plain')", [evidenceId, uuid(), uuid(), projectId, goalId, "concertmaster", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    }
    const first = input(projectA, goalA, "1", evidenceA);
    const second = input(projectB, goalB, "1", evidenceB);
    const decision = decidePortfolioCouncil({
      ...first,
      councilId: uuid(), commandId: uuid(),
      goals: [first.goals[0]!, second.goals[0]!],
      actions: [first.actions[0]!, { ...second.actions[0]!, goalId: goalB }],
      evidenceReferences: [evidenceA, evidenceB],
    });
    const proofA = await acquireGoalLease(pool, { goalId: goalA, ownerId: "concertmaster", leaseDurationMs: 60_000 });
    const proofB = await acquireGoalLease(pool, { goalId: goalB, ownerId: "concertmaster", leaseDurationMs: 60_000 });
    const recorded = await recordPortfolioCouncilDecision(pool, { projectId: projectA, decision, actorId: "concertmaster", sessionRef: "session:portfolio", goalProofs: [proofA, proofB] });
    expect(recorded.projectIds).toEqual([projectA, projectB]);
    expect(recorded.goals).toHaveLength(2);
  });

  it("rejects a decision whose Goal is outside the project boundary", async () => {
    const projectId = uuid();
    const otherProjectId = uuid();
    const goalId = uuid();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, otherProjectId]);
    const evidenceId = uuid();
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'portfolio', 'text/plain')", [evidenceId, uuid(), uuid(), otherProjectId, goalId, "concertmaster", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    const decision = decidePortfolioCouncil(input(projectId, goalId, "1", evidenceId));
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "concertmaster", leaseDurationMs: 60_000 });
    await expect(recordPortfolioCouncilDecision(pool, { projectId, decision, actorId: "concertmaster", sessionRef: "session:portfolio", goalProofs: [proof] })).rejects.toThrow(/project/);
  });
});
