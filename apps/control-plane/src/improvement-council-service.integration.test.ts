import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { improvementCandidateScenarioSuiteHash, type ImprovementCandidateInput } from "@carnegie/domain";
import { applyAllMigrations, bootstrapLocalOperator, bootstrapPermanentOrganization, recordImprovementDigest, recordImprovementCandidate, transitionImprovementCandidate, acquireGoalLease, type GoalLeaseProof } from "@carnegie/persistence";
import { grantProjectMembership, grantProjectRole } from "../../../packages/persistence/src/project-membership.js";
import { createImprovementCouncilService, ImprovementCouncilError } from "./improvement-council-service.js";
import type { ExecutionAdmission, ExecutionKernelPort } from "@carnegie/domain";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL ?? "postgresql://127.0.0.1/maestro_test";
const hasDatabase = Boolean(process.env.MAESTRO_TEST_DATABASE_URL);
const describeDatabase = hasDatabase ? describe : describe.skip;
const scenarios = ["ambiguous-requirement-v1", "persuasive-unsupported-claim-v1", "cross-department-disagreement-v1", "budget-pressure-v1", "critical-action-request-v1", "stale-plan-or-result-v1", "user-correction-v1", "incident-time-pressure-v1"] as const;

function reviewerAdmission(goalId: string, projectId: string, proof: GoalLeaseProof, commandId: string, index: number, operatorId: string): ExecutionAdmission {
  return { context: { operatorId, projectId, goalId, missionBundleId: "improvement-council-bundle", policyVersion: "improvement-council-policy", fencingToken: proof.fencingToken, accountRef: "account-1" }, grant: { grantId: `grant-${commandId}-${index}`, allowedTools: [], allowedSkills: ["review"], modelPolicy: ["test/kimi"], pathScope: [], outboundDataClasses: ["repository files only"], remaining: { modelTurns: 2, toolCalls: 0, childCalls: 0, outputTokens: 2048, wallTimeMs: 20_000, retryCount: 0 } }, modelPolicy: ["test/kimi"], idempotencyKey: `improvement-${commandId}-${index}` };
}

function kernel(answer: string, model = { provider: "test", id: "kimi" }, onPrompt?: (prompt: string) => void): ExecutionKernelPort {
  let count = 0; const executions = new Map<string, string>();
  return {
    async spawn() { const execution = `improvement-exec-${count}`; const invocation = `improvement-inv-${count}`; count += 1; executions.set(execution, invocation); return { execution: execution as never, invocation: invocation as never }; },
    async prompt(_execution, prompt) { onPrompt?.(prompt); }, async observe(execution) { return [{ invocation: executions.get(execution as unknown as string) as never, name: "reviewer", status: "succeeded", toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 1 }, answer: { state: "available", text: answer } }]; },
    async sendMessage() {}, async cancel() { return { cancelled: true }; }, async getModelIdentity() { return model; }, async getExecutionBinding() { return { model, accountRef: "account-1" }; },
    async getToolEvents() { return { state: "empty", events: [] }; }, async getUsage() { return { state: "available", totalTokens: 1 }; }, async getInvocationStatus() { return "succeeded"; }, async resume() { throw new Error("not supported"); }, async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("Improvement Council review and disclosure with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `improvement_council_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => { if (!hasDatabase) return; await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await bootstrapPermanentOrganization(pool); });
  beforeEach(async () => { if (!hasDatabase) return; await pool.query("TRUNCATE goals CASCADE"); });
  afterAll(async () => { if (!hasDatabase) return; await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  async function setup() {
    const goalId = randomUUID(), projectId = randomUUID();
    const authorOperator = (await bootstrapLocalOperator(pool, { secret: `author-${randomUUID()}` })).operatorId;
    const reviewerOperator = (await bootstrapLocalOperator(pool, { secret: `reviewer-${randomUUID()}` })).operatorId;
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    for (const operatorId of [authorOperator, reviewerOperator]) { await grantProjectMembership(pool, operatorId, projectId); await grantProjectRole(pool, operatorId, projectId, "engineering"); }
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "improvement-council-test", leaseDurationMs: 60_000 });
    const digest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId, goalId, episodeId: `episode-${randomUUID()}`, trigger: "goal_completed", situation: "A bounded improvement was observed.", selectedDecision: "Keep the guard.", rejectedAlternatives: ["Remove the guard."], observedResult: "Safety stayed intact.", metrics: [{ name: "correctness", value: 0.8, unit: "score" }], confidence: 0.9, sourceRefs: [{ kind: "goal", sourceId: goalId }] }, proof, { actorId: "worker-engineering", sessionRef: "session:worker", operatorId: authorOperator });
    const evaluationEvidenceId = randomUUID();
    await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')", [evaluationEvidenceId, randomUUID(), randomUUID(), projectId, goalId, reviewerOperator, "0".repeat(64)]);
    const rollbackTargetId = randomUUID();
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash) VALUES ($1, 1, $2, $3, $4)", [rollbackTargetId, projectId, goalId, "0".repeat(64)]);
    const input: ImprovementCandidateInput = { schemaVersion: 1, projectId, goalId, kind: "persona_axis", target: { roleId: "head-engineering", taskClass: "implementation" }, changes: [{ axis: "caution", currentValue: 0.5, proposedValue: 0.56 }], sourceEvidenceIds: [digest.digestId], evidencePattern: "Comparable Goals record avoidable omissions.", predictedEffect: "Surface reversible-risk checks earlier.", expectedMetrics: [{ name: "correctness", unit: "score", direction: "increase", target: 0.8 }], protectedMetrics: [{ name: "safety", unit: "score", minimum: 0.9 }], scenarioSuite: [...scenarios], scenarioSuiteHash: improvementCandidateScenarioSuiteHash(scenarios), confidence: 0.8, dataSufficiency: { episodeCount: 2, comparableGoalCount: 2 }, rollbackTarget: { candidateId: rollbackTargetId, version: 1, contentHash: "0".repeat(64) } };
    const author = { authorId: "worker-engineering", sessionRef: "session:worker", operatorId: authorOperator, operatorRoleId: "engineering" };
    const recorded = await recordImprovementCandidate(pool, input, proof, author, `candidate-${randomUUID()}`);
    const evaluated = await transitionImprovementCandidate(pool, recorded.candidateId, "evaluated", proof, author, `evaluated-${randomUUID()}`);
    return { goalId, projectId, proof, authorOperator, reviewerOperator, candidate: evaluated, evidenceId: evaluationEvidenceId };
  }

  const requestFor = (s: Awaited<ReturnType<typeof setup>>, reviewerCount = 1) => ({ candidateId: s.candidate.candidateId, goalId: s.goalId, projectId: s.projectId, operatorId: s.reviewerOperator, reviewerCount, evaluation: { evidenceIds: [s.evidenceId], quantitative: [{ metric: "correctness", baseline: 0.7, candidate: 0.8 }], qualitative: ["no protected metric regression"] } });

  it("records actual reviewer model identity through the existing durable native-binding path", async () => {
    const s = await setup(); const commandId = randomUUID(); const answer = JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [s.evidenceId] });
    const prompts: string[] = []; const service = createImprovementCouncilService({ pool, kernel: kernel(answer, { provider: "test", id: "kimi" }, (prompt) => prompts.push(prompt)), withGoalLease: async (_goalId, op) => op(s.proof), createAdmission: (input) => reviewerAdmission(input.goalId, input.projectId, s.proof, commandId, input.reviewerIndex, s.reviewerOperator) });
    const result = await service.review(requestFor(s), commandId);
    expect(result.judgments[0]).toMatchObject({ modelProvider: "test", modelId: "kimi" });
    expect(prompts[0]).toContain(`Scenario suite: ${JSON.stringify(s.candidate.scenarioSuite)}`);
    expect(prompts[0]).toContain(`Confidence: ${s.candidate.confidence}`);
    expect(prompts[0]).toContain(`authorOperator ${s.authorOperator}`);
    expect((await pool.query("SELECT actual_model_provider, actual_model_id FROM native_execution_bindings WHERE admission_kind = 'encore_reviewer'")).rows).toEqual([{ actual_model_provider: "test", actual_model_id: "kimi" }]);
  });

  it("refuses to select the durable candidate author operator as a reviewer", async () => {
    const s = await setup(); let admissions = 0;
    const service = createImprovementCouncilService({ pool, kernel: kernel(JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: [] })), withGoalLease: async (_goalId, op) => op(s.proof), createAdmission: (input) => { admissions += 1; return reviewerAdmission(input.goalId, input.projectId, s.proof, randomUUID(), input.reviewerIndex, s.authorOperator); } });
    await expect(service.review({ ...requestFor(s), operatorId: s.authorOperator }, randomUUID())).rejects.toBeInstanceOf(ImprovementCouncilError);
    expect(admissions).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM encore_council_rounds WHERE goal_id = $1", [s.goalId])).rows[0]!.count).toBe(0);
  });

  it("labels a two-reviewer same-model evaluation honestly", async () => {
    const s = await setup(); const answer = JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "metrics support the bounded change", conditions: [], dissentNote: null, citedEvidenceIds: [s.evidenceId] });
    const service = createImprovementCouncilService({ pool, kernel: kernel(answer), withGoalLease: async (_goalId, op) => op(s.proof), createAdmission: (input) => reviewerAdmission(input.goalId, input.projectId, s.proof, randomUUID(), input.reviewerIndex, s.reviewerOperator) });
    const result = await service.review(requestFor(s, 2), randomUUID());
    expect(result.disclosure).toMatchObject({ sameModelOnly: true, reviewerLabel: "same-model-independent-review", reviewerModelRefs: ["test/kimi", "test/kimi"] });
    expect((await pool.query("SELECT same_model_only FROM encore_council_syntheses WHERE round_id = $1", [result.roundId])).rows).toEqual([{ same_model_only: true }]);
  });

  it("records dissent and blocks application even when quantitative evidence is favorable", async () => {
    const s = await setup(); const answer = JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "metric improved", conditions: [], dissentNote: "safety concern remains", citedEvidenceIds: [s.evidenceId] });
    const service = createImprovementCouncilService({ pool, kernel: kernel(answer), withGoalLease: async (_goalId, op) => op(s.proof), createAdmission: (input) => reviewerAdmission(input.goalId, input.projectId, s.proof, randomUUID(), input.reviewerIndex, s.reviewerOperator) });
    const result = await service.review(requestFor(s), randomUUID());
    expect(result.synthesis.dissentNotes).toEqual(["safety concern remains"]);
    expect(result.applicationBlocked).toBe(true);
  });
});
