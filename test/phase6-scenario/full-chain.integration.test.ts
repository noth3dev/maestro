import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SYNTHETIC_SCENARIO_SPECS,
  PERSONA_AXES,
  parsePersonaProfile,
  isMissionPersonaOverlayExpired,
  deriveMissionPersonaOverlay,
  selectRoutedModelWithRoutingCandidate,
  snapshotOperationalOverlayForGoal,
  MODEL_CAPABILITY_AXES,
  MODEL_CAPABILITY_SCHEMA_VERSION,
  MODEL_MAP_SCHEMA_VERSION,
  TASK_DEMAND_SCHEMA_VERSION,
  type RoutingSelectionRequest,
  type ModelMap,
  taskContractContentHash,
  type TaskContractSubstance,
  type DepartmentPlanSubstance,
  type MissionBundleSubstance,
  type DecisionPacket,
  type IndependentBrief,
  applyCandidateHardFloors,
  createRoutingCapabilityCandidate,
  improvementCandidateScenarioSuiteHash,
  replayCandidateAgainstFrozenBaseline,
  improvementCandidateContentHash,
  runDeterministicCandidateGuards,
  runShadowEvaluation,
  runSyntheticAdversarialScenarios,
  type CandidateEvaluationMetrics,
  type ImprovementCandidate,
  type ImprovementCandidateInput,
  type RoutingCapabilityCouncilJudgment,
  type ShadowOutput,
  CONCERTMASTER_PERSONA_BASELINE,
  type ExecutionAdmission,
  type ExecutionKernelPort,
} from "@maestro/domain";
import { applyAllMigrations } from "../../packages/persistence/src/test-migrations.js";
import { acquireGoalLease, type GoalLeaseProof } from "../../packages/persistence/src/commands.js";
import { bootstrapPermanentOrganization } from "../../packages/persistence/src/organization.js";
import { grantProjectMembership, grantProjectRole } from "../../packages/persistence/src/project-membership.js";
import { recordImprovementDigest } from "../../packages/persistence/src/improvement-digest.js";
import { proposeOrganizationalKnowledge, promoteOrganizationalKnowledgeToProject, promoteOrganizationalKnowledgeToGlobal } from "../../packages/persistence/src/organizational-knowledge.js";
import { raiseMetronomeChallenge, readMetronomeChallenge } from "../../packages/persistence/src/metronome-challenge.js";
import { deriveWorkerProfileForMission } from "../../packages/persistence/src/worker-profile-derivation.js";
import { runEncoreCouncilReview } from "../../packages/persistence/src/encore-council.js";
import { createImprovementCouncilService } from "../../apps/control-plane/src/improvement-council-service.js";
import { createHeadCouncil, submitIndependentBrief, revealCouncilBriefs, recordCouncilDecisionPacket } from "../../packages/persistence/src/council.js";
import { createDepartmentPlan } from "../../packages/persistence/src/department-plan.js";
import { createMissionBundle, issueMissionPersonaOverlay, readActiveMissionPersonaOverlay, type IssueMissionPersonaOverlayRequest } from "../../packages/persistence/src/mission-bundle.js";
import {
  recordImprovementCandidate,
  readImprovementCandidate,
  readImprovementCandidateDecisionHistory,
  recordImprovementCandidateEvaluation,
  transitionImprovementCandidateAfterCouncil,
  transitionImprovementCandidate,
  transitionRoutingCandidateToJudged,
  recordRoutingCandidateEvaluation,
  type ImprovementCandidateAuthor,
} from "../../packages/persistence/src/improvement-candidate.js";
import { enableImprovementClass, startBoundedRollout, observeBoundedRollout } from "../../packages/persistence/src/rollout-controller.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const actorId = randomUUID();
const evaluatorOperatorId = randomUUID();
const author: ImprovementCandidateAuthor = { authorId: "phase6-worker", sessionRef: "phase6-scenario", operatorId: actorId, operatorRoleId: "engineering" };
const actor = { operatorId: actorId, actorId: "phase6-rollout", sessionRef: "phase6-rollout", operatorRoleId: "engineering" };

type ScenarioGoal = { projectId: string; goalId: string; evidenceId: string; evidenceIds: string[]; proof: GoalLeaseProof; digestId: string; digestIds: string[] };

function metrics(overrides: Partial<CandidateEvaluationMetrics> = {}): CandidateEvaluationMetrics {
  return { correctness: 0.96, safety: 0.97, authority: 1, cost: 80, ...overrides };
}

function candidateInput(goal: ScenarioGoal, kind: "routing_capability_axis" | "persona_axis", rollbackTarget: string, changes: ImprovementCandidateInput["changes"], rollbackContentHash = "b".repeat(64)): ImprovementCandidateInput {
  const scenarioSuite = kind === "routing_capability_axis" ? ["routing-capability-v1"] : SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.scenarioId);
  const target = kind === "routing_capability_axis"
    ? { roleId: "head-engineering", taskClass: "implementation", routingTarget: "provider/model-a" }
    : { roleId: "head-engineering", taskClass: "implementation" };
  return {
    schemaVersion: 1, projectId: goal.projectId, goalId: goal.goalId, kind, target, changes,
    sourceEvidenceIds: [...goal.digestIds], evidencePattern: "Repeated evidence-backed review weakness.",
    predictedEffect: "Increase useful verification while preserving authority and safety.",
    expectedMetrics: [{ name: "correctness", unit: "score", direction: "increase", target: 0.95 }],
    protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9 }], scenarioSuite,
    scenarioSuiteHash: improvementCandidateScenarioSuiteHash(scenarioSuite), confidence: 0.86,
    dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
    rollbackTarget: { candidateId: rollbackTarget, version: 1, contentHash: rollbackContentHash },
  };
}

function routingRequest(goalRef: string): RoutingSelectionRequest {
  const capability = (score: number) => ({ schemaVersion: MODEL_CAPABILITY_SCHEMA_VERSION, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored" as const, score, rationale: "human-owned baseline", evidence: ["human-review"] }])) }) as never;
  const providerFacts = (price: number) => ({ schemaVersion: 1 as const, contextCapacity: 128_000, pricing: { inputPerMillionTokens: price, outputPerMillionTokens: price * 2 }, authentication: { modes: ["api-key"] }, dataPolicy: { allowedDataClasses: ["public"], retention: "transient" as const, trainingUse: "never" as const, regions: ["us"] }, modalities: ["text"], toolCalls: { supported: true }, provenance: { source: "human-reviewed provider facts", observedAt: "2026-09-14" } });
  const modelMap: ModelMap = { schemaVersion: MODEL_MAP_SCHEMA_VERSION, entries: [
    { modelRef: "provider/model-a", capability: capability(140), providerFacts: providerFacts(1), provenance: { owner: "human", sourceRefs: ["human-review"], reviewedAt: "2026-09-14" } },
    { modelRef: "provider/model-b", capability: capability(150), providerFacts: providerFacts(2), provenance: { owner: "human", sourceRefs: ["human-review"], reviewedAt: "2026-09-14" } },
  ] };
  const requirements = Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head-owned task requirement" }])) as never;
  const operational = snapshotOperationalOverlayForGoal({ schemaVersion: 1, installationRef: "phase6-installation", projectRef: "phase6-project", version: 1, observations: [
    { candidateRef: "route-a", measuredLatencyMs: 20, measuredCost: 1, failureRate: 0.01, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-14T01:00:00.000Z" },
    { candidateRef: "route-b", measuredLatencyMs: 10, measuredCost: 2, failureRate: 0.02, timeoutRate: 0, providerErrorRate: 0, currentAvailability: true, accountBinding: "account-1", observedAt: "2026-09-14T01:00:00.000Z" },
  ] }, goalRef);
  return { mode: "ensemble", goalRef, approvedModels: ["provider/model-a", "provider/model-b"], taskDemand: { schemaVersion: TASK_DEMAND_SCHEMA_VERSION, taskKinds: ["coding"], requirements, provenance: { taskContractRef: "phase6-contract", headDecisionRef: "phase6-head-decision" } }, modelMap, operationalOverlay: operational, candidates: [{ candidateRef: "route-a", modelRef: "provider/model-a", accountBinding: "account-1" }, { candidateRef: "route-b", modelRef: "provider/model-b", accountBinding: "account-1" }], pressure: 120 };
}

async function seedGoal(pool: Pool, label: string): Promise<ScenarioGoal> {
  const projectId = randomUUID(); const goalId = randomUUID(); const evidenceIds = [randomUUID(), randomUUID(), randomUUID()];
  await pool.query("INSERT INTO local_operators (operator_id, active) VALUES ($1, true) ON CONFLICT (operator_id) DO NOTHING", [actorId]);
  await pool.query("INSERT INTO local_operators (operator_id, active) VALUES ($1, true) ON CONFLICT (operator_id) DO NOTHING", [evaluatorOperatorId]);
  await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
  await grantProjectMembership(pool, actorId, projectId); await grantProjectRole(pool, actorId, projectId, "engineering");
  await grantProjectMembership(pool, evaluatorOperatorId, projectId); await grantProjectRole(pool, evaluatorOperatorId, projectId, "engineering");
  await grantProjectRole(pool, actorId, projectId, "head-engineering"); await grantProjectRole(pool, actorId, projectId, "head-product");
  await grantProjectRole(pool, evaluatorOperatorId, projectId, "head-engineering"); await grantProjectRole(pool, evaluatorOperatorId, projectId, "head-product");
  for (const [index, evidenceId] of evidenceIds.entries()) {
    await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test-result', 'text/plain', 'project_lifetime')`, [evidenceId, randomUUID(), randomUUID(), projectId, goalId, actorId, createHash("sha256").update(`${label}-${index}`).digest("hex"), label.length,]);
  }
  const proof = await acquireGoalLease(pool, { goalId, ownerId: `phase6-${label}`, leaseDurationMs: 120_000 });
  const digestIds: string[] = [];
  for (const [index, evidenceId] of evidenceIds.entries()) {
    const digest = await recordImprovementDigest(pool, {
      schemaVersion: 1, projectId, goalId, episodeId: `phase6-${label}-${index}`,
      trigger: "quality_signal", situation: "Repeated verification weakness was observed.", selectedDecision: "Record a bounded improvement proposal.",
      rejectedAlternatives: ["Change authority or safety boundaries."], observedResult: "A measurable quality gap remained.",
      metrics: [{ name: "correctness", value: 0.91 - index * 0.01, unit: "score" }], confidence: 0.9,
      sourceRefs: [{ kind: "evidence_record", sourceId: evidenceId }],
    }, proof, { actorId: author.authorId, sessionRef: author.sessionRef });
    digestIds.push(digest.digestId);
    await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'improvement-digest', 'application/json', 'project_lifetime')`, [digest.digestId, randomUUID(), randomUUID(), projectId, goalId, actorId, digest.contentHash, JSON.stringify(digest).length]);
  }
  return { projectId, goalId, evidenceId: evidenceIds[0]!, evidenceIds, proof, digestId: digestIds[0]!, digestIds };
}

async function seedComparableGoal(pool: Pool, parent: ScenarioGoal): Promise<string> {
  const goalId = randomUUID(); const evidenceId = randomUUID();
  await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, parent.projectId]);
  await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')`, [evidenceId, randomUUID(), randomUUID(), parent.projectId, goalId, actorId, "c".repeat(64)]);
  const proof = await acquireGoalLease(pool, { goalId, ownerId: `phase6-comparable-${randomUUID()}`, leaseDurationMs: 120_000 });
  const digest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId: parent.projectId, goalId, episodeId: `phase6-comparable-${randomUUID()}`, trigger: "quality_signal",
    situation: "Comparable verification weakness was observed.", selectedDecision: "Record comparable evidence.", rejectedAlternatives: [], observedResult: "The same bounded gap appeared.", metrics: [{ name: "correctness", value: 0.9, unit: "score" }], confidence: 0.9,
    sourceRefs: [{ kind: "evidence_record", sourceId: evidenceId }], }, proof, { actorId: author.authorId, sessionRef: author.sessionRef });
  await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'improvement-digest', 'application/json', 'project_lifetime')`, [digest.digestId, randomUUID(), randomUUID(), parent.projectId, goalId, actorId, digest.contentHash]);
  return goalId;
}

function councilProof(candidate: ImprovementCandidate, roundId: string, evidenceIds: readonly string[]): RoutingCapabilityCouncilJudgment {
  const reviewer = (modelProvider: string, modelId: string) => ({ modelProvider, modelId, verdict: "proceed" as const, confidence: "high" as const,
    reasoning: "Independent evidence supports this bounded change.", conditions: [], dissentNote: null, citedEvidenceIds: [...evidenceIds] });
  return { candidateId: candidate.candidateId, candidateVersion: candidate.version, candidateContentHash: candidate.contentHash,
    councilRoundId: roundId, evidenceIds: [...evidenceIds], judgments: [reviewer("provider-a", "model-a"), reviewer("provider-b", "model-b")] };
}

function encoreAdmission(goal: ScenarioGoal, commandId: string, index: number, sameModel = false): ExecutionAdmission {
  const model = sameModel || index === 0 ? "provider-a/model-a" : "provider-b/model-b";
  return {
    context: { operatorId: evaluatorOperatorId, projectId: goal.projectId, goalId: goal.goalId, missionBundleId: "encore-bundle", policyVersion: "encore-policy", fencingToken: goal.proof.fencingToken, accountRef: "account-1" },
    grant: { grantId: `phase6-encore-grant-${commandId}-${index}`, allowedTools: [], allowedSkills: ["review"], modelPolicy: [model], pathScope: [], outboundDataClasses: ["repository files only"], remaining: { modelTurns: 2, toolCalls: 0, childCalls: 0, outputTokens: 2048, wallTimeMs: 20_000, retryCount: 0 } },
    modelPolicy: [model], idempotencyKey: `phase6-encore-${commandId}-${index}`,
  };
}

function kernelWithAnswers(evidenceIds: readonly string[], sameModel = false): ExecutionKernelPort {
  let counter = 0; const namespace = randomUUID(); const invocations = new Map<string, { invocation: string; provider: string; id: string }>();
  return {
    async spawn() { const index = counter++; const provider = sameModel || index === 0 ? "provider-a" : "provider-b"; const id = sameModel || index === 0 ? "model-a" : "model-b"; const execution = `${namespace}-exec-${index}`; const invocation = `${namespace}-inv-${index}`; invocations.set(execution, { invocation, provider, id }); return { execution: execution as never, invocation: invocation as never }; },
    async prompt() {}, async sendMessage() {},
    async observe(execution) { const item = invocations.get(execution as unknown as string); return item === undefined ? [] : [{ invocation: item.invocation as never, name: "deterministic-reviewer", status: "succeeded" as const, toolEvents: { state: "empty" as const, events: [] }, usage: { state: "available" as const, totalTokens: 1 }, answer: { state: "available" as const, text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "Independent evidence supports this bounded change.", conditions: [], dissentNote: null, citedEvidenceIds: [...evidenceIds] }) } }]; },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity(execution) { const item = invocations.get(execution as unknown as string); if (item === undefined) throw new Error("Unknown execution"); return { provider: item.provider, id: item.id }; },
    async getExecutionBinding(execution) { const item = invocations.get(execution as unknown as string); if (item === undefined) throw new Error("Unknown execution"); return { model: { provider: item.provider, id: item.id }, accountRef: "account-1" }; },
    async getToolEvents() { return { state: "empty" as const, events: [] }; }, async getUsage() { return { state: "available" as const, totalTokens: 1 }; }, async getInvocationStatus() { return "succeeded" as const; },
    async resume() { throw new Error("not supported"); }, async reconnect() { throw new Error("not supported"); }, async release() {},
  };
}

async function shadow(pool: Pool, candidate: ImprovementCandidateInput, goal: ScenarioGoal, label: string, candidateId?: string): Promise<{ result: Awaited<ReturnType<typeof runShadowEvaluation>>; digestId: string; shadowEvidenceId: string; taskFit: number }> {
  const input = { request: `phase6 ${label}` }; const active: ShadowOutput = { messages: ["I will verify before acting."], plans: [{ step: "verify" }], challenges: [{ kind: "risk-review" }] };
  const processRef = `phase6-process-${label}-${randomUUID()}`; const sessionId = `phase6-session-${label}`; const runId = `phase6-shadow-${label}-${randomUUID()}`; const shadowEvidenceId = randomUUID();
  const client = await pool.connect();
  let result: Awaited<ReturnType<typeof runShadowEvaluation>>;
  try {
    await client.query("BEGIN");
    result = await runShadowEvaluation({ runId, processRef, sessionId, processPid: 4321, candidate, cases: [{ input, activeInput: input, active }], recordedEvidence: { [goal.evidenceId]: { observed: label }, ...Object.fromEntries(goal.digestIds.map((id) => [id, { observed: label }])) },
      evaluate: async (_input, context) => { context.readRecordedEvidence(goal.evidenceId); return { messages: [`shadow-${label}-${JSON.stringify(candidate.changes)}`], plans: [{ step: "verify" }], challenges: [{ kind: "risk-review" }] }; },
      journal: { append: async (event) => { await client.query(`INSERT INTO ipython_session_journal (journal_id, session_id, process_ref, project_id, goal_id, event, reason, process_pid, details, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'project_lifetime')`, [randomUUID(), event.sessionId, event.processRef, event.projectId, event.goalId, event.event, event.event === "started" ? null : event.reason ?? `shadow ${event.event}`, event.processPid ?? 4321, JSON.stringify({ phase: "full-chain-proof", label, candidateId: candidateId ?? candidate.parentCandidateId ?? null, candidateContentHash: JSON.stringify(candidate), ...event.details })]); } },
      resultSink: { commit: async (evidence, lifecycle) => { const payload = JSON.stringify(evidence); await client.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'shadow-evaluation', 'application/json', 'project_lifetime')`, [shadowEvidenceId, randomUUID(), randomUUID(), candidate.projectId, candidate.goalId, actorId, createHash("sha256").update(payload).digest("hex"), payload.length]); await lifecycle.append({ sessionId: evidence.identity.sessionId, processRef: evidence.identity.processRef, projectId: evidence.identity.projectId, goalId: evidence.identity.goalId, event: "orphaned", reason: "shadow evidence committed before terminal close", processPid: evidence.identity.processPid, details: { phase: "full-chain-proof", label, shadowEvidenceId, candidateContentHash: evidence.candidateContentHash, shadowRunId: evidence.identity.runId } }); await lifecycle.append({ sessionId: evidence.identity.sessionId, processRef: evidence.identity.processRef, projectId: evidence.identity.projectId, goalId: evidence.identity.goalId, event: "completed", reason: "shadow evidence durably closed", processPid: evidence.identity.processPid, details: { phase: "full-chain-proof", label, shadowEvidenceId, candidateContentHash: evidence.candidateContentHash, shadowRunId: evidence.identity.runId } }); } }, kernel: undefined });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  const shadowEvidence = await pool.query("SELECT evidence_id FROM evidence_records WHERE evidence_id = $1 AND project_id = $2 AND goal_id = $3 AND kind = 'shadow-evaluation'", [shadowEvidenceId, candidate.projectId, candidate.goalId]);
  const journalEvidence = await pool.query<{ count: number; candidate_content_hash: string | null }>("SELECT count(*)::int AS count, max(details->>'candidate_content_hash') AS candidate_content_hash FROM ipython_session_journal WHERE process_ref = $1 AND project_id = $2 AND goal_id = $3 AND event IN ('started', 'orphaned', 'completed')", [processRef, candidate.projectId, candidate.goalId]);
  expect(result.status).toBe("completed"); expect(shadowEvidence.rowCount).toBe(1); expect(Number(journalEvidence.rows[0]!.count)).toBe(3); expect(journalEvidence.rows[0]!.candidate_content_hash).toBe(improvementCandidateContentHash(candidate));
  const digest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId: goal.projectId, goalId: goal.goalId, episodeId: `phase6-shadow-${label}-${randomUUID()}`,
    trigger: "quality_signal", situation: "Shadow evaluation completed on identical input.", selectedDecision: "Retain shadow comparison as evidence.", rejectedAlternatives: ["Use live authority during shadow."],
    observedResult: JSON.stringify(result.records), metrics: [{ name: "correctness", value: 0.96, unit: "score" }, { name: "task_fit", value: result.records[0]!.proposed.messages.length, unit: "message_count" }], confidence: 0.95,
    sourceRefs: [{ kind: "evidence_record", sourceId: goal.evidenceId }, { kind: "evidence_record", sourceId: shadowEvidenceId }], }, goal.proof, { actorId: author.authorId, sessionRef: author.sessionRef });
  await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'improvement-digest', 'application/json', 'project_lifetime')`, [digest.digestId, randomUUID(), randomUUID(), goal.projectId, goal.goalId, actorId, digest.contentHash, JSON.stringify(digest).length]);
  return { result, digestId: digest.digestId, shadowEvidenceId, taskFit: result.records[0]!.proposed.messages.length };
}

async function exercisePersistentWorkerOverlay(pool: Pool, goal: ScenarioGoal, activePersona: Record<string, number>): Promise<{ readonly overlayPersona: Record<string, number>; readonly expired: boolean; readonly councilId: string; readonly planVersion: number; readonly itemId: string; readonly profileRef: string; readonly bundleContentHash: string; readonly workerId: string }> {
  const contractId = randomUUID(); const councilId = randomUUID(); const activeSessionRef = `phase6-head-session-${goal.goalId}`;
  const contract: TaskContractSubstance = { desiredOutcome: "deliver safely", userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [], project: { projectId: goal.projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" }, evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [], budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] } };
  await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contract), taskContractContentHash(contract)]);
  await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'engineering', 'head:engineering', $2, 'active', $3)", [goal.goalId, contractId, activeSessionRef]);
  const context = (actorId: string, sessionRef: string) => ({ actorId, sessionRef, commandId: randomUUID() });
  const council = await createHeadCouncil(pool, { councilId, goalId: goal.goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: [goal.evidenceId] } }, goal.proof, context("concertmaster", "phase6-secretary"));
  const brief: IndependentBrief = { interpretation: "bounded execution", contribution: "review worker overlay", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: ["one"], expectedCost: "1", expectedTime: "1 hour", objectionsToLikelyAlternatives: [] };
  await submitIndependentBrief(pool, council.councilId, "engineering", brief, goal.proof, context("head:engineering", activeSessionRef)); await revealCouncilBriefs(pool, council.councilId, goal.proof, context("concertmaster", "phase6-reveal"));
  const packet: DecisionPacket = { outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed", rejectedAlternatives: [], departmentOwnership: [{ departmentId: "engineering", responsibility: "own execution" }], workerPlan: [], completionCriteria: ["done"], failureCriteria: ["unsafe"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
  const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, goal.proof, context("concertmaster", "phase6-decision"));
  const planSubstance: DepartmentPlanSubstance = { contribution: "bounded execution", nonGoals: [], items: [{ itemId: "exec-1", kind: "execution", objective: "verify safely", dependsOn: [], scoutQuestion: "", workerAssignment: "verify", evidenceReferences: [] }], requiredHandoffs: [], budgetCeiling: "1", expectedTime: "1 hour", maxRetries: 1, maxWorkers: 1, gitRepository: "repo", gitBranch: "phase6", integrationPath: "packages", risks: [], safePausePoints: ["before write"], escalationTriggers: ["unsafe choice"], evidenceReferences: [], validationCriteria: ["tests pass"] };
  const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "engineering", substance: planSubstance }, goal.proof, context("head:engineering", activeSessionRef));
  const taskDemand = { schemaVersion: 1 as const, taskKinds: ["coding"] as const, requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level: 80, rationale: "Head requirement" }])) as never, provenance: { taskContractRef: contractId, headDecisionRef: council.councilId } };
  const bundleSubstance: MissionBundleSubstance = { role: "execution", profileRef: "phase6-profile", goalBrief: "verify safely", taskDemand, approvedModels: ["provider/model-a"], allowedSkills: ["review"], allowedTools: ["read"], allowedPaths: ["packages"], environment: ["node24"], authorityBoundary: ["read-only"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"], costCeiling: "1", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0, deliverable: "verification", evidenceRequirements: ["evidence"], validationCriteria: ["tests pass"], terminationConditions: ["done"] };
  const bundle = await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "engineering", itemId: "exec-1", substance: bundleSubstance }, goal.proof, context("head:engineering", activeSessionRef));
  const workerId = randomUUID();
  await pool.query(`INSERT INTO workers (worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state)
    VALUES ($1, $2, 'engineering', $3, 'exec-1', $4, 1, $5, $6, 'spawned', $7, $8::bigint, clock_timestamp() + interval '1 minute', clock_timestamp(), 'none')`, [workerId, resolved.councilId, plan.version, bundle.contentHash, `phase6-worker-${workerId}`, `phase6-invocation-${workerId}`, goal.proof.ownerId, goal.proof.fencingToken]);
  const overlayRequest: IssueMissionPersonaOverlayRequest = { councilId: resolved.councilId, departmentId: "engineering", planVersion: plan.version, itemId: "exec-1", inputs: { departmentStyle: activePersona, headChoice: activePersona, taskAmbiguity: 0.5, risk: 0.5, collaborationDemand: 0.5, evidenceBurden: 0.5 }, missionLifetimeMs: 60_000 };
  const overlay = await issueMissionPersonaOverlay(pool, overlayRequest, goal.proof, context("head:engineering", activeSessionRef));
  await expect(readActiveMissionPersonaOverlay(pool, resolved.councilId, "engineering", plan.version, "exec-1", new Date())).resolves.toMatchObject({ councilId: resolved.councilId, itemId: "exec-1" });
  let expired = false; try { await readActiveMissionPersonaOverlay(pool, resolved.councilId, "engineering", plan.version, "exec-1", new Date(Date.parse(overlay.expiresAt) + 1)); } catch { expired = true; }
  return { overlayPersona: overlay.persona, expired, councilId: resolved.councilId, planVersion: plan.version, itemId: "exec-1", profileRef: bundleSubstance.profileRef, bundleContentHash: bundle.contentHash, workerId };
}

describeDatabase("Plan 6 full-chain proof", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `phase6_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { if (pool !== undefined) await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("runs routing and persona improvements through all fourteen acceptance gates", async () => {
    const routeGoal = await seedGoal(pool, "routing"); const personaGoal = await seedGoal(pool, "persona");
    const routeRollbackPlaceholder = randomUUID(); const personaRollbackPlaceholder = randomUUID();
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, 1, $2, $3, $4, 'routing_capability_axis', 'head-engineering', 'implementation')", [routeRollbackPlaceholder, routeGoal.projectId, routeGoal.goalId, "b".repeat(64)]);
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, 1, $2, $3, $4, 'persona_axis', 'head-engineering', 'implementation')", [personaRollbackPlaceholder, personaGoal.projectId, personaGoal.goalId, "b".repeat(64)]);

    const routeComparableGoalId = await seedComparableGoal(pool, routeGoal);
    const routeBaselineInput = candidateInput(routeGoal, "routing_capability_axis", routeRollbackPlaceholder, [{ axis: "coding", currentValue: 65, proposedValue: 70 }]);
    const routeBaseline = await recordImprovementCandidate(pool, createRoutingCapabilityCandidate(routeBaselineInput), routeGoal.proof, author, `phase6-route-baseline-${randomUUID()}`);
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, $2, $3, $4, $5, 'routing_capability_axis', 'head-engineering', 'implementation')", [routeBaseline.candidateId, routeBaseline.version, routeGoal.projectId, routeGoal.goalId, routeBaseline.contentHash]);
    const routeRaw = candidateInput(routeGoal, "routing_capability_axis", routeBaseline.candidateId, [{ axis: "coding", currentValue: 70, proposedValue: 76 }], routeBaseline.contentHash);
    const routeDraftShadow = await shadow(pool, routeRaw, routeGoal, "routing-draft");
    const routeInput = createRoutingCapabilityCandidate({ ...routeRaw, sourceEvidenceIds: [...routeRaw.sourceEvidenceIds, routeDraftShadow.digestId] }); const routeCandidate = await recordImprovementCandidate(pool, routeInput, routeGoal.proof, author, `phase6-route-${randomUUID()}`);
    const routeEvaluated = await transitionImprovementCandidate(pool, routeCandidate.candidateId, "evaluated", routeGoal.proof, author, `phase6-route-eval-${randomUUID()}`);
    const replay = replayCandidateAgainstFrozenBaseline(routeInput, { scenarioSuite: routeInput.scenarioSuite, goals: [
      { goalId: routeGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) },
      { goalId: routeComparableGoalId, input: { request: "compare" }, baseline: metrics({ cost: 100 }) },
    ], evaluate: () => metrics() });
    const synthetic = runSyntheticAdversarialScenarios(routeInput, { scenarios: SYNTHETIC_SCENARIO_SPECS, evaluate: () => metrics() });
    expect(replay.status).toBe("compared"); expect(synthetic.status).toBe("completed");
    const routeShadow = await shadow(pool, routeInput, routeGoal, "routing", routeCandidate.candidateId);
    const routeEvaluation = { replay, synthetic };
    const routeEvaluationRecord = await recordRoutingCandidateEvaluation(pool, routeEvaluated.candidateId, routeGoal.proof, routeEvaluation, `phase6-eval-${randomUUID()}`);
    const routeEvaluationEvidence = await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'routing-evaluation', 'application/json', 'project_lifetime')`, [routeEvaluationRecord.evaluationId, randomUUID(), randomUUID(), routeGoal.projectId, routeGoal.goalId, actorId, routeEvaluationRecord.evaluationHash]);
    const routeEvidenceIds = [...routeGoal.digestIds, routeDraftShadow.digestId, routeShadow.digestId, routeEvaluationRecord.evaluationId];
    expect(routeEvaluationEvidence.rowCount).toBe(1);
    const routeCouncilCommandId = randomUUID();
    const routeCouncilService = createImprovementCouncilService({ pool, kernel: kernelWithAnswers(routeEvidenceIds), withGoalLease: async (_goalId, operation) => operation(routeGoal.proof),
      createAdmission: (input) => encoreAdmission(routeGoal, input.commandId, input.reviewerIndex) });
    const routeCouncil = await routeCouncilService.review({ candidateId: routeEvaluated.candidateId, goalId: routeGoal.goalId, projectId: routeGoal.projectId, operatorId: evaluatorOperatorId, reviewerCount: 2,
      evaluation: { evidenceIds: routeEvidenceIds, quantitative: [{ metric: "correctness", baseline: 0.96, candidate: 0.96 }, { metric: "cost", baseline: 100, candidate: 80 }], qualitative: ["Durable shadow comparison changed only the proposed behavior.", "All reviewed adversarial scenarios passed."] } }, routeCouncilCommandId);
    const routeCouncilBinding = await pool.query<{ question: string; evidence_ids: unknown }>("SELECT question, evidence_ids FROM encore_council_rounds WHERE round_id = $1 AND question LIKE $2", [routeCouncil.roundId, `%${routeEvaluated.candidateId}%`]);
    expect(routeCouncilBinding.rowCount).toBe(1); expect(JSON.stringify(routeCouncilBinding.rows[0]!.evidence_ids)).toContain(routeEvaluationRecord.evaluationId); expect(JSON.stringify(routeCouncilBinding.rows[0]!.evidence_ids)).toContain(routeShadow.digestId);
    const sameModelCommandId = randomUUID();
    const sameModelCouncil = await runEncoreCouncilReview(pool, kernelWithAnswers(routeEvidenceIds, true), { goalId: routeGoal.goalId, proof: routeGoal.proof, commandId: sameModelCommandId,
      question: "Disclose same-model review diversity accurately.", criteria: [{ criterionId: "disclosure", description: "label same-model evidence" }], evidenceIds: routeEvidenceIds, reviewerCount: 2,
      admission: (index) => encoreAdmission(routeGoal, sameModelCommandId, index, true) });
    const routeJudgment = councilProof(routeEvaluated, routeCouncil.roundId, routeEvidenceIds);
    const routeJudged = await transitionRoutingCandidateToJudged(pool, routeEvaluated.candidateId, routeGoal.proof, author, {
      evaluationId: routeEvaluationRecord.evaluationId, evaluationHash: routeEvaluationRecord.evaluationHash, councilRoundId: routeCouncil.roundId, councilJudgment: routeJudgment,
    }, `phase6-route-judge-${randomUUID()}`);
    const routingBaseline = routingRequest(routeGoal.goalId); const modelMapBefore = JSON.stringify(routingBaseline.modelMap);
    const routeSelectionJudgment = councilProof(routeJudged, routeCouncil.roundId, routeEvidenceIds);
    const routeSelection = selectRoutedModelWithRoutingCandidate(routingBaseline, routeJudged, routeSelectionJudgment);
    const modelMapAfter = JSON.stringify(routingBaseline.modelMap);
    await enableImprovementClass(pool, routeGoal.projectId, "routing_capability_axis", routeGoal.proof, actor, `phase6-enable-route-${randomUUID()}`);
    const routeRollout = await startBoundedRollout(pool, routeJudged.candidateId, { roleId: "head-engineering", taskClass: "implementation", maxGoalCount: 1, windowStart: "2026-09-14T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" }, routeGoal.proof, actor, `phase6-start-route-${randomUUID()}`);
    const routeOutcome = await observeBoundedRollout(pool, routeRollout.rolloutId, { goalId: routeGoal.goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.84 }] }, routeGoal.proof, actor, `phase6-observe-route-${randomUUID()}`);
    expect(routeOutcome.status).toBe("rolled_back"); expect(routeOutcome.activeCandidateId).toBe(routeBaseline.candidateId); expect(routeShadow.result.status).toBe("completed");

    const activePersona = await import("../../packages/persistence/src/persona-profile.js").then(({ readActivePersonaProfile }) => readActivePersonaProfile(pool, "head-engineering", "implementation"));
    const headBaselineBefore = await pool.query("SELECT version, profile, source FROM persona_profile_versions WHERE role_id = 'head-engineering' ORDER BY version DESC LIMIT 1");
    const derivedWorkerOverlay = deriveMissionPersonaOverlay({ departmentStyle: activePersona.persona, headChoice: activePersona.persona, taskAmbiguity: 0.4, risk: 0.8, collaborationDemand: 0.6, evidenceBurden: 0.9 });
    const personaBaselineInput = candidateInput(personaGoal, "persona_axis", personaRollbackPlaceholder, [{ axis: "caution", currentValue: activePersona.persona.caution, proposedValue: Math.min(1, activePersona.persona.caution + 0.01) }, { axis: "realism", currentValue: activePersona.persona.realism, proposedValue: Math.min(1, activePersona.persona.realism + 0.01) }]);
    const personaBaseline = await recordImprovementCandidate(pool, personaBaselineInput, personaGoal.proof, author, `phase6-persona-baseline-${randomUUID()}`);
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, $2, $3, $4, $5, 'persona_axis', 'head-engineering', 'implementation')", [personaBaseline.candidateId, personaBaseline.version, personaGoal.projectId, personaGoal.goalId, personaBaseline.contentHash]);
    const personaRaw = candidateInput(personaGoal, "persona_axis", personaBaseline.candidateId, [{ axis: "caution", currentValue: activePersona.persona.caution, proposedValue: Math.min(1, activePersona.persona.caution + 0.04) }, { axis: "realism", currentValue: activePersona.persona.realism, proposedValue: Math.min(1, activePersona.persona.realism + 0.03) }], personaBaseline.contentHash);
    const boundsRows = await pool.query<{ axis: string; floor_value: number; ceiling_value: number }>("SELECT axis, floor_value, ceiling_value FROM role_persona_bounds WHERE role_id = 'head-engineering'");
    const floors = Object.fromEntries(boundsRows.rows.map((row) => [row.axis, row.floor_value])); const ceilings = Object.fromEntries(boundsRows.rows.map((row) => [row.axis, row.ceiling_value]));
    const guardDraft = runDeterministicCandidateGuards(personaRaw, { roleFloors: floors, roleCeilings: ceilings, mandatoryScenarioIds: SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.scenarioId), baselineProfile: activePersona.persona, existingProfiles: [activePersona.persona, { ...activePersona.persona, caution: Math.max(0, activePersona.persona.caution - 0.1) }], diversityPreserved: true });
    expect(guardDraft.passed).toBe(true);
    const personaDraftShadow = await shadow(pool, personaRaw, personaGoal, "persona-draft");
    const replayDraft = replayCandidateAgainstFrozenBaseline(personaRaw, { scenarioSuite: personaRaw.scenarioSuite, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, goals: [{ goalId: personaGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) }], evaluate: () => metrics({ correctness: 0.98 }) });
    expect(replayDraft.status).toBe("compared"); const syntheticDraft = runSyntheticAdversarialScenarios(personaRaw, { scenarios: SYNTHETIC_SCENARIO_SPECS, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, evaluate: () => metrics({ correctness: 0.97 }) });
    expect(syntheticDraft.status).toBe("completed");
    const personaEvaluationDigest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId: personaGoal.projectId, goalId: personaGoal.goalId, episodeId: `phase6-persona-evaluation-${randomUUID()}`,
      trigger: "quality_signal", situation: "Replay and synthetic evaluation completed against the frozen persona baseline.", selectedDecision: "Retain the bounded evaluation evidence.", rejectedAlternatives: ["Skip adversarial scenarios."],
      observedResult: JSON.stringify({ replay: replayDraft, synthetic: syntheticDraft }), metrics: [{ name: "correctness", value: 0.97, unit: "score" }], confidence: 0.95,
      sourceRefs: [{ kind: "evidence_record", sourceId: personaGoal.evidenceId }, { kind: "evidence_record", sourceId: personaDraftShadow.digestId }], }, personaGoal.proof, { actorId: author.authorId, sessionRef: author.sessionRef });
    const personaEvaluationEvidence = await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'improvement-evaluation', 'application/json', 'project_lifetime')`, [personaEvaluationDigest.digestId, randomUUID(), randomUUID(), personaGoal.projectId, personaGoal.goalId, actorId, personaEvaluationDigest.contentHash]);
    expect(personaEvaluationDigest.digestId).toMatch(/[0-9a-f-]{36}/); expect(personaEvaluationEvidence.rowCount).toBe(1);
    const personaEvidenceIds = [...personaGoal.digestIds, personaEvaluationDigest.digestId, personaDraftShadow.digestId];
    const personaInput = { ...personaRaw, sourceEvidenceIds: personaEvidenceIds };
    const personaCandidate = await recordImprovementCandidate(pool, personaInput, personaGoal.proof, author, `phase6-persona-${randomUUID()}`);
    const personaEvaluated = await transitionImprovementCandidate(pool, personaCandidate.candidateId, "evaluated", personaGoal.proof, author, `phase6-persona-eval-${randomUUID()}`);
    const guard = runDeterministicCandidateGuards(personaInput, { roleFloors: floors, roleCeilings: ceilings, mandatoryScenarioIds: SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.scenarioId), baselineProfile: activePersona.persona, existingProfiles: [activePersona.persona, { ...activePersona.persona, caution: Math.max(0, activePersona.persona.caution - 0.1) }], diversityPreserved: true });
    expect(guard.passed).toBe(true);
    const personaReplay = replayCandidateAgainstFrozenBaseline(personaInput, { scenarioSuite: personaInput.scenarioSuite, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, goals: [{ goalId: personaGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) }], evaluate: () => metrics({ correctness: 0.98 }) });
    expect(personaReplay.status).toBe("compared"); const personaSynthetic = runSyntheticAdversarialScenarios(personaInput, { scenarios: SYNTHETIC_SCENARIO_SPECS, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, evaluate: () => metrics({ correctness: 0.97 }) });
    expect(personaSynthetic.status).toBe("completed");
    const personaShadow = await shadow(pool, personaInput, personaGoal, "persona", personaCandidate.candidateId);
    const personaEvaluation = await recordImprovementCandidateEvaluation(pool, personaEvaluated.candidateId, personaGoal.proof, { evidenceIds: [...personaEvidenceIds, personaShadow.digestId], payload: { replay: personaReplay, synthetic: personaSynthetic, shadow: personaShadow.result } }, `phase6-persona-evaluation-${randomUUID()}`);
    const personaCouncilEvidenceIds = [...personaEvidenceIds, personaShadow.digestId, personaEvaluation.evaluationId];
    const persistedPersonaEvaluation = await pool.query<{ candidate_id: string; candidate_version: number; candidate_content_hash: string; evaluation_hash: string }>("SELECT candidate_id, candidate_version, candidate_content_hash, evaluation_hash FROM improvement_candidate_evaluations WHERE evaluation_id = $1", [personaEvaluation.evaluationId]);
    expect(persistedPersonaEvaluation.rows[0]).toMatchObject({ candidate_id: personaEvaluated.candidateId, candidate_version: personaEvaluated.version, candidate_content_hash: personaEvaluated.contentHash, evaluation_hash: personaEvaluation.evaluationHash });
    const personaCouncilCommandId = randomUUID();
    const personaCouncilService = createImprovementCouncilService({ pool, kernel: kernelWithAnswers(personaCouncilEvidenceIds), withGoalLease: async (_goalId, operation) => operation(personaGoal.proof),
      createAdmission: (input) => encoreAdmission(personaGoal, input.commandId, input.reviewerIndex) });
    const personaCouncil = await personaCouncilService.review({ candidateId: personaEvaluated.candidateId, goalId: personaGoal.goalId, projectId: personaGoal.projectId, operatorId: evaluatorOperatorId, reviewerCount: 2,
      evaluation: { evidenceIds: personaCouncilEvidenceIds, evaluationId: personaEvaluation.evaluationId, evaluationHash: personaEvaluation.evaluationHash, quantitative: [{ metric: "correctness", baseline: 0.96, candidate: 0.98 }, { metric: "cost", baseline: 100, candidate: 80 }], qualitative: ["The candidate remains within reviewed persona floors.", "The persistent overlay and shadow comparison are bounded."] } }, personaCouncilCommandId);
    const personaCouncilBinding = await pool.query<{ question: string; evidence_ids: unknown }>("SELECT question, evidence_ids FROM encore_council_rounds WHERE round_id = $1 AND question LIKE $2", [personaCouncil.roundId, `%${personaEvaluated.candidateId}%`]);
    expect(personaCouncilBinding.rowCount).toBe(1); expect(JSON.stringify(personaCouncilBinding.rows[0]!.evidence_ids)).toContain(personaShadow.digestId); expect(JSON.stringify(personaCouncilBinding.rows[0]!.evidence_ids)).toContain(personaEvaluation.evaluationId);
    const sameOperatorService = createImprovementCouncilService({ pool, kernel: kernelWithAnswers(personaCouncilEvidenceIds), withGoalLease: async (_goalId, operation) => operation(personaGoal.proof),
      createAdmission: (input) => ({ ...encoreAdmission(personaGoal, input.commandId, input.reviewerIndex), context: { ...encoreAdmission(personaGoal, input.commandId, input.reviewerIndex).context, operatorId: actorId } }) });
    await expect(sameOperatorService.review({ candidateId: personaEvaluated.candidateId, goalId: personaGoal.goalId, projectId: personaGoal.projectId, operatorId: evaluatorOperatorId, reviewerCount: 1, evaluation: { evidenceIds: personaCouncilEvidenceIds, evaluationId: personaEvaluation.evaluationId, evaluationHash: personaEvaluation.evaluationHash, quantitative: [{ metric: "correctness", baseline: 0.96, candidate: 0.98 }], qualitative: ["same-operator guard"] } }, randomUUID())).rejects.toThrow(/author|review/i);
    const knowledge = await proposeOrganizationalKnowledge(pool, { schemaVersion: 1, projectId: personaGoal.projectId, sourceGoalId: personaGoal.goalId, departmentId: "engineering", statement: "Bounded verification improves implementation task fit without expanding authority.", rationale: "A generalized lesson retains no raw project content.", sourceEvidenceIds: personaGoal.evidenceIds, sourceDigestIds: personaGoal.digestIds, episodeIds: personaGoal.digestIds.map((_id, index) => `phase6-persona-${index}`), confidence: 0.9, freshness: 1, generalized: true, noRawProjectContent: true, noPersonalInformation: true }, personaGoal.proof, { actorId: personaGoal.proof.ownerId, sessionRef: "phase6-knowledge-author", operatorId: actorId, operatorRoleId: "engineering" }, `phase6-knowledge-${randomUUID()}`);
    const projectKnowledge = await promoteOrganizationalKnowledgeToProject(pool, { knowledgeId: knowledge.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: evaluatorOperatorId, departmentId: "engineering", proof: personaGoal.proof, idempotencyKey: `phase6-project-knowledge-${randomUUID()}` });
    const knowledgeCouncilCommandId = randomUUID();
    const knowledgeCouncil = await runEncoreCouncilReview(pool, kernelWithAnswers(personaGoal.digestIds), { goalId: personaGoal.goalId, proof: personaGoal.proof, commandId: knowledgeCouncilCommandId, question: "Should this generalized lesson cross the project boundary?", criteria: [{ criterionId: "privacy", description: "retain only generalized, non-private evidence" }], evidenceIds: personaGoal.digestIds, reviewerCount: 2, admission: (index) => encoreAdmission(personaGoal, knowledgeCouncilCommandId, index) });
    const globalKnowledge = await promoteOrganizationalKnowledgeToGlobal(pool, { knowledgeId: projectKnowledge.knowledgeId, promoterRoleId: "head-engineering", promoterOperatorId: evaluatorOperatorId, departmentId: "engineering", proof: personaGoal.proof, encoreCouncilRoundId: knowledgeCouncil.roundId, corroboratingSourceIds: personaGoal.digestIds, corroboratingEpisodeIds: personaGoal.digestIds.map((_id, index) => `phase6-persona-${index}`), generalizedStatement: "Bounded verification improves implementation task fit without expanding authority.", curatorRoleId: "head-product", curatorOperatorId: actorId, idempotencyKey: `phase6-global-knowledge-${randomUUID()}` });
    const personaJudged = await transitionImprovementCandidateAfterCouncil(pool, personaEvaluated.candidateId, personaGoal.proof, author, `phase6-persona-judge-${randomUUID()}`);
    await enableImprovementClass(pool, personaGoal.projectId, "persona_axis", personaGoal.proof, actor, `phase6-enable-persona-${randomUUID()}`);
    const personaRollout = await startBoundedRollout(pool, personaJudged.candidateId, { roleId: "head-engineering", taskClass: "implementation", maxGoalCount: 1, windowStart: "2026-09-14T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" }, personaGoal.proof, actor, `phase6-start-persona-${randomUUID()}`);
    const personaOutcome = await observeBoundedRollout(pool, personaRollout.rolloutId, { goalId: personaGoal.goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.96 }] }, personaGoal.proof, actor, `phase6-observe-persona-${randomUUID()}`);
    const appliedPersona = await import("../../packages/persistence/src/persona-profile.js").then(({ readActivePersonaProfile }) => readActivePersonaProfile(pool, "head-engineering", "implementation"));
    const persistentWorkerOverlay = await exercisePersistentWorkerOverlay(pool, personaGoal, appliedPersona.persona);
    const derivedWorkerProfile = await deriveWorkerProfileForMission(pool, { workerId: persistentWorkerOverlay.workerId, councilId: persistentWorkerOverlay.councilId, departmentId: "engineering", planVersion: persistentWorkerOverlay.planVersion, itemId: persistentWorkerOverlay.itemId, profileRef: persistentWorkerOverlay.profileRef, roleId: "head-engineering", taskClass: "implementation" });
    expect(personaOutcome.status).toBe("certified"); expect(personaShadow.result.status).toBe("completed"); expect(personaCouncil.judgments).toHaveLength(2);
    const metronomeChallenge = await raiseMetronomeChallenge(pool, personaGoal.goalId, [], { reason: "unsafe worker choice needs Head review", evidenceReferences: [personaGoal.evidenceId], targetRef: `${persistentWorkerOverlay.councilId}/engineering/${persistentWorkerOverlay.planVersion}/${persistentWorkerOverlay.itemId}` }, personaGoal.proof, { actorId: "encore-metronome", sessionRef: "phase6-metronome", commandId: randomUUID() });
    const readChallenge = await readMetronomeChallenge(pool, metronomeChallenge.challengeId);

    let replayCalls = 0; const forbidden = { ...personaInput, changes: [{ axis: "authority" as "caution", currentValue: 0.7, proposedValue: 0.8 }] };
    const badReplay = replayCandidateAgainstFrozenBaseline(forbidden, { scenarioSuite: forbidden.scenarioSuite, goals: [{ goalId: personaGoal.goalId, input: {}, baseline: metrics() }], evaluate: () => { replayCalls += 1; return metrics(); } });
    const badSynthetic = runSyntheticAdversarialScenarios(forbidden, { scenarios: SYNTHETIC_SCENARIO_SPECS, evaluate: () => { replayCalls += 1; return metrics(); } });
    const coreForbidden = { ...personaInput, changes: [{ axis: "core-identity" as "caution", currentValue: 0.7, proposedValue: 0.8 }] };
    const coreBadReplay = replayCandidateAgainstFrozenBaseline(coreForbidden, { scenarioSuite: coreForbidden.scenarioSuite, goals: [{ goalId: personaGoal.goalId, input: {}, baseline: metrics() }], evaluate: () => { replayCalls += 1; return metrics(); } });
    const challengeSuppressed = { ...personaInput, scenarioSuite: personaInput.scenarioSuite.filter((scenarioId) => scenarioId !== "critical-action-request-v1"), scenarioSuiteHash: improvementCandidateScenarioSuiteHash(personaInput.scenarioSuite.filter((scenarioId) => scenarioId !== "critical-action-request-v1")) };
    const challengeBadReplay = replayCandidateAgainstFrozenBaseline(challengeSuppressed, { scenarioSuite: challengeSuppressed.scenarioSuite, guards: { mandatoryScenarioIds: ["critical-action-request-v1"] }, goals: [{ goalId: personaGoal.goalId, input: {}, baseline: metrics() }], evaluate: () => { replayCalls += 1; return metrics(); } });
    const routeForbidden = { ...routeInput, changes: [{ axis: "authority" as "coding", currentValue: 70, proposedValue: 80 }] };
    const routeBadReplay = replayCandidateAgainstFrozenBaseline(routeForbidden, { scenarioSuite: routeForbidden.scenarioSuite, goals: [{ goalId: routeGoal.goalId, input: {}, baseline: metrics() }], evaluate: () => { replayCalls += 1; return metrics(); } });
    const routeBadSynthetic = runSyntheticAdversarialScenarios(routeForbidden, { scenarios: SYNTHETIC_SCENARIO_SPECS, evaluate: () => { replayCalls += 1; return metrics(); } });
    expect(badReplay.status).toBe("rejected"); expect(badSynthetic.status).toBe("rejected"); expect(coreBadReplay.status).toBe("rejected"); expect(challengeBadReplay.status).toBe("rejected"); expect(routeBadReplay.status).toBe("rejected"); expect(routeBadSynthetic.status).toBe("rejected"); expect(replayCalls).toBe(0);

    const sameModel = sameModelCouncil.synthesis;
    const hardFloor = applyCandidateHardFloors({ baseline: metrics({ correctness: 0.96 }), candidate: metrics({ correctness: 0.5, cost: 1 }), floors: { correctness: 0.9, safety: 0.9, authority: 0.9 } });
    const convergedProfile = { ...activePersona.persona, caution: personaRaw.changes[0]!.proposedValue, realism: personaRaw.changes[1]!.proposedValue };
    const diversity = runDeterministicCandidateGuards(personaInput, { baselineProfile: activePersona.persona, existingProfiles: [convergedProfile] });
    const overlayCaution = Math.min(0.01, Math.max(0, 1 - activePersona.persona.caution));
    const overlayRealism = Math.min(0.01, Math.max(0, 1 - activePersona.persona.realism));
    const resulting = await (await import("../../packages/persistence/src/persona-profile.js")).readActivePersonaProfile(pool, "head-engineering", "implementation", { caution: overlayCaution, realism: overlayRealism });
    const globalRows = await pool.query<{ role_id: string; profile: unknown; source: string }>("SELECT role_id, profile, source FROM persona_profile_versions");
    const concertmasterSeed = await pool.query<{ profile: unknown }>("SELECT profile FROM persona_profile_versions WHERE role_id = 'concertmaster' AND version = 1");
    const headBaselineAfter = await pool.query("SELECT version, profile, source FROM persona_profile_versions WHERE role_id = 'head-engineering' ORDER BY version DESC LIMIT 1");
    const persistedPersona = await readImprovementCandidate(pool, personaCouncil.candidateId, { operatorId: evaluatorOperatorId, proof: personaGoal.proof });
    const uiHistory = await readImprovementCandidateDecisionHistory(pool, persistedPersona.candidateId, { operatorId: evaluatorOperatorId, proof: personaGoal.proof });
    const uiExplanation = { ...uiHistory.explanation, evidence: uiHistory.explanation.evidenceIds, councilRoundId: uiHistory.council?.roundId, durableHistory: uiHistory.evaluation !== null && uiHistory.approval !== null && uiHistory.council !== null && uiHistory.rollouts.length > 0 };
    const knowledgeRows = await pool.query<{ scope: string; project_id: string | null; source_project_id: string; generalized: boolean; source_evidence_ids: unknown }>("SELECT scope, project_id, source_project_id, generalized, source_evidence_ids FROM organizational_knowledge WHERE knowledge_id = $1 ORDER BY revision", [knowledge.knowledgeId]);
    const routeCouncilRows = await pool.query<{ model_provider: string; model_id: string }>("SELECT model_provider, model_id FROM encore_council_judgments WHERE round_id = $1", [routeCouncil.roundId]);
    const invalidAxisRejections = PERSONA_AXES.every((axis) => { try { parsePersonaProfile({ ...activePersona.persona, [axis]: 1.1 }); return false; } catch { return true; } });
    const incompleteCandidates = [
      { ...personaInput, sourceEvidenceIds: [] },
      { ...personaInput, scenarioSuite: [] },
      { ...personaInput, rollbackTarget: undefined as never },
    ].every((candidate) => !runDeterministicCandidateGuards(candidate).passed);
    const acceptance: readonly [string, boolean][] = [
      ["all ten axes reject out-of-range values", invalidAxisRejections && Object.values(resulting.persona).every((value) => value >= 0 && value <= 1)],
      ["Concertmaster seed is untouched", concertmasterSeed.rowCount === 1 && Object.keys(concertmasterSeed.rows[0]!.profile as Record<string, unknown>).length === Object.keys(CONCERTMASTER_PERSONA_BASELINE).length && Object.entries(CONCERTMASTER_PERSONA_BASELINE).every(([axis, value]) => (concertmasterSeed.rows[0]!.profile as Record<string, unknown>)[axis] === value)],
      ["mission overlay expires without mutating baseline", resulting.layers.learnedProfile.profile.caution !== resulting.persona.caution && JSON.stringify(headBaselineBefore.rows) === JSON.stringify(headBaselineAfter.rows) && isMissionPersonaOverlayExpired({ expiresAt: "2026-09-14T00:00:00.000Z" }, new Date("2026-09-14T01:00:00.000Z"))],
      ["authority/core identity cannot be optimized", badReplay.status === "rejected" && coreBadReplay.status === "rejected" && routeBadReplay.status === "rejected" && challengeBadReplay.status === "rejected"],
      ["evidence/scenario/rollback are required", incompleteCandidates],
      ["same-model evaluation is labeled", sameModel.sameModelOnly === true && sameModelCouncil.judgments.every((judgment) => judgment.modelProvider === "provider-a" && judgment.modelId === "model-a")],
      ["low-cost regression fails hard floor", hardFloor.accepted === false],
      ["diversity collapse fails", diversity.passed === false],
      ["route regression restores exact version", routeOutcome.status === "rolled_back" && routeOutcome.activeCandidateId === routeBaseline.candidateId && routeOutcome.activeVersion === routeBaseline.version && routeOutcome.rollbackTarget.contentHash === routeBaseline.contentHash],
            ["explanation carries changed axes/effect/evidence/rollback", uiExplanation.durableHistory && uiExplanation.councilRoundId === personaCouncil.roundId && uiExplanation.changedAxes.length === 2 && uiExplanation.expectedBehavior.length > 0 && uiExplanation.evidence.includes(personaShadow.digestId) && uiExplanation.rollback !== undefined],
       ["live worker consumes the applied persona candidate", derivedWorkerProfile.taskClassTemplate.caution === appliedPersona.persona.caution && derivedWorkerProfile.taskClassTemplate.realism === appliedPersona.persona.realism && derivedWorkerProfile.profile.caution === appliedPersona.persona.caution && derivedWorkerProfile.profile.realism === appliedPersona.persona.realism && derivedWorkerProfile.workerId === persistentWorkerOverlay.workerId],
      ["project evidence is not global profile data", globalKnowledge.scope === "global" && globalKnowledge.generalized === true && globalKnowledge.statement.includes("without expanding authority") && knowledgeRows.rows.some((row) => row.scope === "global" && row.project_id === null && row.source_project_id === personaGoal.projectId && row.generalized === true && !JSON.stringify(row.source_evidence_ids).includes(personaGoal.evidenceId)) && globalRows.rows.every((row) => !JSON.stringify(row.profile).includes(personaGoal.evidenceId) && !personaGoal.digestIds.some((digestId) => JSON.stringify(row.profile).includes(digestId)))],
      ["bounded overlay is readable and challengeable", resulting.layers.missionOverlay.caution === overlayCaution && Object.values(derivedWorkerOverlay).every((value) => value >= 0 && value <= 1) && Object.values(persistentWorkerOverlay.overlayPersona).every((value) => value >= 0 && value <= 1) && persistentWorkerOverlay.expired && !isMissionPersonaOverlayExpired({ expiresAt: "2026-09-14T02:00:00.000Z" }, new Date("2026-09-14T01:00:00.000Z")) && isMissionPersonaOverlayExpired({ expiresAt: "2026-09-14T00:00:00.000Z" }, new Date("2026-09-14T01:00:00.000Z")) && readChallenge.status === "open" && readChallenge.targetRef === `${persistentWorkerOverlay.councilId}/engineering/${persistentWorkerOverlay.planVersion}/${persistentWorkerOverlay.itemId}` && metronomeChallenge.evidenceReferences.includes(personaGoal.evidenceId)],
      ["same replay is deterministic and measurable", personaReplay.status === "compared" && personaReplay.results[0]!.candidate.correctness > personaReplay.results[0]!.baseline.correctness && JSON.stringify(personaReplay) === JSON.stringify(replayCandidateAgainstFrozenBaseline(personaInput, { scenarioSuite: personaInput.scenarioSuite, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, goals: [{ goalId: personaGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) }], evaluate: () => metrics({ correctness: 0.98 }) }))],
      ["shadow output changes behavior without permissions", personaShadow.taskFit > 0 && personaShadow.result.records.length > 0 && personaShadow.result.records[0]!.matchesActive === false && personaShadow.result.records[0]!.readEvidenceIds.includes(personaGoal.evidenceId) && personaShadow.result.liveEffects.length === 0 && JSON.stringify(personaShadow.result.records[0]!.input) === JSON.stringify(personaShadow.result.records[0]!.activeInput) && JSON.stringify(personaShadow.result.records[0]!.active.plans) === JSON.stringify(personaShadow.result.records[0]!.proposed.plans) && JSON.stringify(personaShadow.result.records[0]!.active.challenges) === JSON.stringify(personaShadow.result.records[0]!.proposed.challenges)],
    ];
    for (const [name, passed] of acceptance) expect(passed, name).toBe(true);
    const nativeReviewerOperators = await pool.query<{ operator_id: string }>("SELECT DISTINCT operator_id FROM native_execution_bindings WHERE goal_id = $1 AND admission_kind = 'encore_reviewer'", [routeGoal.goalId]);
    expect(routeEvaluationRecord.evaluationId).toMatch(/[0-9a-f-]{36}/); expect(routeCouncil.judgments).toHaveLength(2); expect(routeRollout.status).toBe("active");
    expect(routeJudged.authorId).not.toBe(routeCouncilRows.rows[0]!.model_id); expect(nativeReviewerOperators.rows).toEqual([{ operator_id: evaluatorOperatorId }]); expect(author.operatorId).not.toBe(evaluatorOperatorId); expect(routeCouncilRows.rows.map((row) => `${row.model_provider}/${row.model_id}`)).toEqual(["provider-a/model-a", "provider-b/model-b"]);
    expect(routeJudged.state).toBe("judged"); expect(routeSelection.goalRef).toBe(routeGoal.goalId); expect(routeSelection.selectedModelRef).toBe("provider/model-b"); expect(modelMapBefore).toBe(modelMapAfter); expect(globalRows.rowCount).toBeGreaterThan(0);
  });
});
