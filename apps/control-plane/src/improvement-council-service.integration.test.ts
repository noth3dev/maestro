import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionAdmission, ExecutionKernelPort } from "@maestro/domain";
import { improvementCandidateScenarioSuiteHash, type ImprovementCandidate } from "@maestro/domain";
import { applyAllMigrations } from "@maestro/persistence";
import { acquireGoalLease, type GoalLeaseProof } from "@maestro/persistence";
import { createImprovementCouncilService, ImprovementCouncilError } from "./improvement-council-service.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const scenarios = ["ambiguous-requirement-v1", "persuasive-unsupported-claim-v1", "cross-department-disagreement-v1", "budget-pressure-v1", "critical-action-request-v1", "stale-plan-or-result-v1", "user-correction-v1", "incident-time-pressure-v1"] as const;

function candidate(goalId: string, projectId: string, authorId: string, sourceEvidenceId: string): ImprovementCandidate {
  return {
    candidateId: randomUUID(), version: 1, parentCandidateId: null, authorId, sessionRef: "session:improvement-author", createdAt: new Date().toISOString(), state: "evaluated",
    schemaVersion: 1, projectId, goalId, kind: "persona_axis", target: { roleId: "security" },
    changes: [{ axis: "caution", currentValue: 0.5, proposedValue: 0.56 }], sourceEvidenceIds: [sourceEvidenceId],
    evidencePattern: "independent safety findings repeat across comparable Goals", predictedEffect: "improve conservative handling of unsafe requests",
    expectedMetrics: [{ name: "correctness", unit: "score", direction: "increase", target: 0.8 }], protectedMetrics: [{ name: "safety", unit: "score", minimum: 0.9 }],
    scenarioSuite: scenarios, scenarioSuiteHash: improvementCandidateScenarioSuiteHash(scenarios), confidence: 0.8,
    dataSufficiency: { episodeCount: 2, comparableGoalCount: 2 }, rollbackTarget: { candidateId: randomUUID(), version: 1, contentHash: "a".repeat(64) }, contentHash: "b".repeat(64),
  };
}

function reviewerAdmission(goalId: string, projectId: string, proof: GoalLeaseProof, commandId: string, index: number, operatorId = "reviewer-operator"): ExecutionAdmission {
  return { context: { operatorId, projectId, goalId, missionBundleId: "improvement-council-bundle", policyVersion: "improvement-council-policy", fencingToken: proof.fencingToken, accountRef: "account-1" }, grant: { grantId: `grant-${commandId}-${index}`, allowedTools: [], allowedSkills: ["review"], modelPolicy: ["test/kimi"], pathScope: [], outboundDataClasses: ["repository files only"], remaining: { modelTurns: 2, toolCalls: 0, childCalls: 0, outputTokens: 2048, wallTimeMs: 20_000, retryCount: 0 } }, modelPolicy: ["test/kimi"], idempotencyKey: `improvement-${commandId}-${index}` };
}

function kernel(answer: string, model = { provider: "test", id: "kimi" }): ExecutionKernelPort {
  let count = 0; const executions = new Map<string, string>();
  return {
    async spawn() { const execution = `improvement-exec-${count}`; const invocation = `improvement-inv-${count}`; count += 1; executions.set(execution, invocation); return { execution: execution as never, invocation: invocation as never }; },
    async prompt() {}, async observe(execution) { return [{ invocation: executions.get(execution as unknown as string) as never, name: "reviewer", status: "succeeded", toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 1 }, answer: { state: "available", text: answer } }]; },
    async sendMessage() {}, async cancel() { return { cancelled: true }; }, async getModelIdentity() { return model; }, async getExecutionBinding() { return { model, accountRef: "account-1" }; },
    async getToolEvents() { return { state: "empty", events: [] }; }, async getUsage() { return { state: "available", totalTokens: 1 }; }, async getInvocationStatus() { return "succeeded"; }, async resume() { throw new Error("not supported"); }, async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("Improvement Council review and disclosure with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => { await applyAllMigrations(pool); });
  beforeEach(async () => { await pool.query("TRUNCATE goals, native_execution_bindings, encore_council_syntheses, encore_council_judgments, encore_council_rounds, evidence_records, goal_leases, outbox, goal_events, command_receipts, goal_controls CASCADE"); });
  afterAll(async () => { await pool.end(); });

  async function setup() {
    const goalId = randomUUID(), projectId = randomUUID(), authorId = randomUUID(), evidenceId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')", [evidenceId, randomUUID(), randomUUID(), projectId, goalId, authorId, "0".repeat(64)]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "improvement-council-test", leaseDurationMs: 60_000 });
    return { goalId, projectId, authorId, evidenceId, proof };
  }

  it("records actual reviewer model identity through the existing durable native-binding path", async () => {
    const s = await setup(); const commandId = randomUUID(); const c = candidate(s.goalId, s.projectId, s.authorId, s.evidenceId);
    const service = createImprovementCouncilService({ pool, kernel: kernel(JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [s.evidenceId] })), withGoalLease: async (_goalId, op) => op(s.proof), createAdmission: (input) => reviewerAdmission(input.goalId, input.projectId, s.proof, commandId, input.reviewerIndex) });
    const result = await service.review({ candidate: c, reviewerCount: 1, evaluation: { evidenceIds: [s.evidenceId], quantitative: [{ metric: "correctness", baseline: 0.7, candidate: 0.8 }], qualitative: ["no protected metric regression"] } }, commandId);
    expect(result.judgments[0]).toMatchObject({ modelProvider: "test", modelId: "kimi" });
    expect(result.synthesis.sameModelOnly).toBe(true);
    expect((await pool.query("SELECT actual_model_provider, actual_model_id FROM native_execution_bindings WHERE admission_kind = 'encore_reviewer'")).rows).toEqual([{ actual_model_provider: "test", actual_model_id: "kimi" }]);
  });

  it("refuses to select the candidate author as a reviewer", async () => {
    const s = await setup(); const c = candidate(s.goalId, s.projectId, s.authorId, s.evidenceId); let admissions = 0;
    const service = createImprovementCouncilService({ pool, kernel: kernel(JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [] })), withGoalLease: async (_goalId, op) => op(s.proof), createAdmission: (input) => { admissions += 1; return reviewerAdmission(input.goalId, input.projectId, s.proof, "author", input.reviewerIndex, s.authorId); } });
    await expect(service.review({ candidate: c, reviewerCount: 1, evaluation: { evidenceIds: [s.evidenceId], quantitative: [], qualitative: ["review"] } }, randomUUID())).rejects.toBeInstanceOf(ImprovementCouncilError);
    expect(admissions).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM encore_council_rounds WHERE goal_id = $1", [s.goalId])).rows[0]!.count).toBe(0);
  });

  it("labels same-model evaluation honestly and preserves that disclosure", async () => {
    const s = await setup(); const c = candidate(s.goalId, s.projectId, s.authorId, s.evidenceId); const answer = JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "metrics support the bounded change", conditions: [], dissentNote: null, citedEvidenceIds: [s.evidenceId] });
    const service = createImprovementCouncilService({ pool, kernel: kernel(answer), withGoalLease: async (_goalId, op) => op(s.proof), createAdmission: (input) => reviewerAdmission(input.goalId, input.projectId, s.proof, "same-model", input.reviewerIndex) });
    const result = await service.review({ candidate: c, reviewerCount: 1, evaluation: { evidenceIds: [s.evidenceId], quantitative: [{ metric: "correctness", baseline: 0.7, candidate: 0.8 }], qualitative: [] } }, randomUUID());
    expect(result.disclosure).toMatchObject({ sameModelOnly: true, reviewerLabel: "same-model-independent-review" });
  });

  it("records dissent and blocks application even when quantitative evidence is favorable", async () => {
    const s = await setup(); const c = candidate(s.goalId, s.projectId, s.authorId, s.evidenceId); const answer = JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "metric improved", conditions: [], dissentNote: "safety concern remains", citedEvidenceIds: [s.evidenceId] });
    const service = createImprovementCouncilService({ pool, kernel: kernel(answer), withGoalLease: async (_goalId, op) => op(s.proof), createAdmission: (input) => reviewerAdmission(input.goalId, input.projectId, s.proof, "dissent", input.reviewerIndex) });
    const result = await service.review({ candidate: c, reviewerCount: 1, evaluation: { evidenceIds: [s.evidenceId], quantitative: [{ metric: "correctness", baseline: 0.7, candidate: 0.95 }], qualitative: ["independent safety concern"] } }, randomUUID());
    expect(result.synthesis.dissentNotes).toEqual(["safety concern remains"]);
    expect(result.applicationBlocked).toBe(true);
  });
});
