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
  applyCandidateHardFloors,
  createRoutingCapabilityCandidate,
  improvementCandidateScenarioSuiteHash,
  replayCandidateAgainstFrozenBaseline,
  runDeterministicCandidateGuards,
  runShadowEvaluation,
  runSyntheticAdversarialScenarios,
  synthesizeEncoreJudgments,
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
import { raiseMetronomeChallenge, readMetronomeChallenge } from "../../packages/persistence/src/metronome-challenge.js";
import { runEncoreCouncilReview } from "../../packages/persistence/src/encore-council.js";
import {
  recordImprovementCandidate,
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

function encoreAdmission(goal: ScenarioGoal, commandId: string, index: number): ExecutionAdmission {
  const model = index === 0 ? "provider-a/model-a" : "provider-b/model-b";
  return {
    context: { operatorId: evaluatorOperatorId, projectId: goal.projectId, goalId: goal.goalId, missionBundleId: "encore-bundle", policyVersion: "encore-policy", fencingToken: goal.proof.fencingToken, accountRef: "account-1" },
    grant: { grantId: `phase6-encore-grant-${commandId}-${index}`, allowedTools: [], allowedSkills: ["review"], modelPolicy: [model], pathScope: [], outboundDataClasses: ["repository files only"], remaining: { modelTurns: 2, toolCalls: 0, childCalls: 0, outputTokens: 2048, wallTimeMs: 20_000, retryCount: 0 } },
    modelPolicy: [model], idempotencyKey: `phase6-encore-${commandId}-${index}`,
  };
}

function kernelWithAnswers(evidenceIds: readonly string[]): ExecutionKernelPort {
  let counter = 0; const namespace = randomUUID(); const invocations = new Map<string, { invocation: string; provider: string; id: string }>();
  return {
    async spawn() { const index = counter++; const provider = index === 0 ? "provider-a" : "provider-b"; const id = index === 0 ? "model-a" : "model-b"; const execution = `${namespace}-exec-${index}`; const invocation = `${namespace}-inv-${index}`; invocations.set(execution, { invocation, provider, id }); return { execution: execution as never, invocation: invocation as never }; },
    async prompt() {}, async sendMessage() {},
    async observe(execution) { const item = invocations.get(execution as unknown as string); return item === undefined ? [] : [{ invocation: item.invocation as never, name: "deterministic-reviewer", status: "succeeded" as const, toolEvents: { state: "empty" as const, events: [] }, usage: { state: "available" as const, totalTokens: 1 }, answer: { state: "available" as const, text: JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "Independent evidence supports this bounded change.", conditions: [], dissentNote: null, citedEvidenceIds: [...evidenceIds] }) } }]; },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity(execution) { const item = invocations.get(execution as unknown as string); if (item === undefined) throw new Error("Unknown execution"); return { provider: item.provider, id: item.id }; },
    async getExecutionBinding(execution) { const item = invocations.get(execution as unknown as string); if (item === undefined) throw new Error("Unknown execution"); return { model: { provider: item.provider, id: item.id }, accountRef: "account-1" }; },
    async getToolEvents() { return { state: "empty" as const, events: [] }; }, async getUsage() { return { state: "available" as const, totalTokens: 1 }; }, async getInvocationStatus() { return "succeeded" as const; },
    async resume() { throw new Error("not supported"); }, async reconnect() { throw new Error("not supported"); }, async release() {},
  };
}

async function shadow(pool: Pool, candidate: ImprovementCandidateInput, goal: ScenarioGoal, label: string): Promise<{ result: Awaited<ReturnType<typeof runShadowEvaluation>>; digestId: string }> {
  const input = { request: `phase6 ${label}` }; const active: ShadowOutput = { messages: ["I will verify before acting."], plans: [{ step: "verify" }], challenges: [{ kind: "risk-review" }] };
  const processRef = `phase6-process-${label}-${randomUUID()}`; const sessionId = `phase6-session-${label}`; const shadowEvidenceId = randomUUID();
  const result = await runShadowEvaluation({ candidate, cases: [{ input, activeInput: input, active }], recordedEvidence: { [goal.evidenceId]: { observed: label }, ...Object.fromEntries(goal.digestIds.map((id) => [id, { observed: label }])) },
    evaluate: async () => ({ messages: [`shadow-${label}`], plans: [{ step: "verify" }], challenges: [{ kind: "risk-review" }] }),
    journal: { append: async (event) => { await pool.query(`INSERT INTO ipython_session_journal (journal_id, session_id, process_ref, project_id, goal_id, event, reason, process_pid, details, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'project_lifetime')`, [randomUUID(), event.sessionId, event.processRef, event.projectId, event.goalId, event.event, event.event === "started" ? null : event.reason ?? `shadow ${event.event}`, event.processPid ?? 4321, JSON.stringify({ phase: "full-chain-proof", label })]); } },
    resultSink: { commit: async (evidence) => { const payload = JSON.stringify(evidence); await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'shadow-evaluation', 'application/json', 'project_lifetime')`, [shadowEvidenceId, randomUUID(), randomUUID(), candidate.projectId, candidate.goalId, actorId, createHash("sha256").update(payload).digest("hex"), payload.length]); } }, runId: `phase6-shadow-${label}-${randomUUID()}`, processRef, sessionId, processPid: 4321 });
  const shadowEvidence = await pool.query("SELECT evidence_id FROM evidence_records WHERE evidence_id = $1 AND project_id = $2 AND goal_id = $3 AND kind = 'shadow-evaluation'", [shadowEvidenceId, candidate.projectId, candidate.goalId]);
  const journalEvidence = await pool.query("SELECT count(*)::int AS count FROM ipython_session_journal WHERE process_ref = $1 AND project_id = $2 AND goal_id = $3", [processRef, candidate.projectId, candidate.goalId]);
  expect(result.status).toBe("completed"); expect(shadowEvidence.rowCount).toBe(1); expect(Number(journalEvidence.rows[0]!.count)).toBeGreaterThan(0);
  const digest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId: goal.projectId, goalId: goal.goalId, episodeId: `phase6-shadow-${label}`,
    trigger: "quality_signal", situation: "Shadow evaluation completed on identical input.", selectedDecision: "Retain shadow comparison as evidence.", rejectedAlternatives: ["Use live authority during shadow."],
    observedResult: JSON.stringify(result.records), metrics: [{ name: "correctness", value: 0.96, unit: "score" }], confidence: 0.95,
    sourceRefs: [{ kind: "evidence_record", sourceId: goal.evidenceId }], }, goal.proof, { actorId: author.authorId, sessionRef: author.sessionRef });
  return { result, digestId: digest.digestId };
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
    const routeInput = createRoutingCapabilityCandidate(routeRaw); const routeCandidate = await recordImprovementCandidate(pool, routeInput, routeGoal.proof, author, `phase6-route-${randomUUID()}`);
    const routeEvaluated = await transitionImprovementCandidate(pool, routeCandidate.candidateId, "evaluated", routeGoal.proof, author, `phase6-route-eval-${randomUUID()}`);
    const replay = replayCandidateAgainstFrozenBaseline(routeInput, { scenarioSuite: routeInput.scenarioSuite, goals: [
      { goalId: routeGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) },
      { goalId: routeComparableGoalId, input: { request: "compare" }, baseline: metrics({ cost: 100 }) },
    ], evaluate: () => metrics() });
    const synthetic = runSyntheticAdversarialScenarios(routeInput, { scenarios: SYNTHETIC_SCENARIO_SPECS, evaluate: () => metrics() });
    expect(replay.status).toBe("compared"); expect(synthetic.status).toBe("completed");
    const routeShadow = await shadow(pool, routeInput, routeGoal, "routing");
    const routeCouncilCommandId = randomUUID();
    const routeCouncil = await runEncoreCouncilReview(pool, kernelWithAnswers(routeGoal.digestIds), { goalId: routeGoal.goalId, proof: routeGoal.proof, commandId: routeCouncilCommandId,
      question: "Should this bounded routing proposal proceed?", criteria: [{ criterionId: "safety", description: "preserve safety and authority" }], evidenceIds: routeGoal.digestIds, reviewerCount: 2,
      admission: (index) => encoreAdmission(routeGoal, routeCouncilCommandId, index) });
    const routeEvaluation = { replay, synthetic };
    const routeEvaluationRecord = await recordRoutingCandidateEvaluation(pool, routeEvaluated.candidateId, routeGoal.proof, routeEvaluation, `phase6-eval-${randomUUID()}`);
    const routeJudgment = councilProof(routeEvaluated, routeCouncil.roundId, routeGoal.digestIds);
    const routeJudged = await transitionRoutingCandidateToJudged(pool, routeEvaluated.candidateId, routeGoal.proof, author, {
      evaluationId: routeEvaluationRecord.evaluationId, evaluationHash: routeEvaluationRecord.evaluationHash, councilRoundId: routeCouncil.roundId, councilJudgment: routeJudgment,
    }, `phase6-route-judge-${randomUUID()}`);
    const routingBaseline = routingRequest(routeGoal.goalId); const modelMapBefore = JSON.stringify(routingBaseline.modelMap);
    const routeSelectionJudgment = councilProof(routeJudged, routeCouncil.roundId, routeGoal.digestIds);
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
    const personaInput = personaRaw; const personaCandidate = await recordImprovementCandidate(pool, personaInput, personaGoal.proof, author, `phase6-persona-${randomUUID()}`);
    const personaEvaluated = await transitionImprovementCandidate(pool, personaCandidate.candidateId, "evaluated", personaGoal.proof, author, `phase6-persona-eval-${randomUUID()}`);
    const boundsRows = await pool.query<{ axis: string; floor_value: number; ceiling_value: number }>("SELECT axis, floor_value, ceiling_value FROM role_persona_bounds WHERE role_id = 'head-engineering'");
    const floors = Object.fromEntries(boundsRows.rows.map((row) => [row.axis, row.floor_value])); const ceilings = Object.fromEntries(boundsRows.rows.map((row) => [row.axis, row.ceiling_value]));
    const guard = runDeterministicCandidateGuards(personaInput, { roleFloors: floors, roleCeilings: ceilings, mandatoryScenarioIds: SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.scenarioId), baselineProfile: activePersona.persona, existingProfiles: [activePersona.persona, { ...activePersona.persona, caution: Math.max(0, activePersona.persona.caution - 0.1) }], diversityPreserved: true });
    expect(guard.passed).toBe(true);
    const personaReplay = replayCandidateAgainstFrozenBaseline(personaInput, { scenarioSuite: personaInput.scenarioSuite, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, goals: [{ goalId: personaGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) }], evaluate: () => metrics({ correctness: 0.98 }) });
    expect(personaReplay.status).toBe("compared"); const personaSynthetic = runSyntheticAdversarialScenarios(personaInput, { scenarios: SYNTHETIC_SCENARIO_SPECS, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, evaluate: () => metrics({ correctness: 0.97 }) });
    expect(personaSynthetic.status).toBe("completed");
    const personaEvaluationDigest = await recordImprovementDigest(pool, { schemaVersion: 1, projectId: personaGoal.projectId, goalId: personaGoal.goalId, episodeId: `phase6-persona-evaluation-${randomUUID()}`,
      trigger: "quality_signal", situation: "Replay and synthetic evaluation completed against the frozen persona baseline.", selectedDecision: "Retain the bounded evaluation evidence.", rejectedAlternatives: ["Skip adversarial scenarios."],
      observedResult: JSON.stringify({ replay: personaReplay, synthetic: personaSynthetic }), metrics: [{ name: "correctness", value: 0.97, unit: "score" }], confidence: 0.95,
      sourceRefs: [{ kind: "evidence_record", sourceId: personaGoal.evidenceId }], }, personaGoal.proof, { actorId: author.authorId, sessionRef: author.sessionRef });
    expect(personaEvaluationDigest.digestId).toMatch(/[0-9a-f-]{36}/);
    const personaShadow = await shadow(pool, personaInput, personaGoal, "persona");
    const personaCouncilCommandId = randomUUID();
    const personaCouncil = await runEncoreCouncilReview(pool, kernelWithAnswers(personaGoal.digestIds), { goalId: personaGoal.goalId, proof: personaGoal.proof, commandId: personaCouncilCommandId,
      question: "Should this bounded persona proposal proceed?", criteria: [{ criterionId: "diversity", description: "preserve profile diversity and floors" }], evidenceIds: personaGoal.digestIds, reviewerCount: 2,
      admission: (index) => encoreAdmission(personaGoal, personaCouncilCommandId, index) });
    const personaJudged = await transitionImprovementCandidate(pool, personaEvaluated.candidateId, "judged", personaGoal.proof, author, `phase6-persona-judge-${randomUUID()}`);
    await enableImprovementClass(pool, personaGoal.projectId, "persona_axis", personaGoal.proof, actor, `phase6-enable-persona-${randomUUID()}`);
    const personaRollout = await startBoundedRollout(pool, personaJudged.candidateId, { roleId: "head-engineering", taskClass: "implementation", maxGoalCount: 1, windowStart: "2026-09-14T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" }, personaGoal.proof, actor, `phase6-start-persona-${randomUUID()}`);
    const personaOutcome = await observeBoundedRollout(pool, personaRollout.rolloutId, { goalId: personaGoal.goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.96 }] }, personaGoal.proof, actor, `phase6-observe-persona-${randomUUID()}`);
    expect(personaOutcome.status).toBe("certified"); expect(personaShadow.result.status).toBe("completed"); expect(personaCouncil.judgments).toHaveLength(2);
    const metronomeChallenge = await raiseMetronomeChallenge(pool, personaGoal.goalId, [], { reason: "unsafe worker choice needs Head review", evidenceReferences: [personaGoal.evidenceId] }, personaGoal.proof, { actorId: "encore-metronome", sessionRef: "phase6-metronome", commandId: randomUUID() });
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

    const sameModel = synthesizeEncoreJudgments([{ modelProvider: "provider-a", modelId: "model-a", verdict: "proceed", confidence: "high", reasoning: "same", conditions: [], dissentNote: null, citedEvidenceIds: [routeGoal.evidenceId] }, { modelProvider: "provider-a", modelId: "model-a", verdict: "proceed", confidence: "high", reasoning: "same", conditions: [], dissentNote: null, citedEvidenceIds: [routeGoal.evidenceId] }]);
    const hardFloor = applyCandidateHardFloors({ baseline: metrics({ correctness: 0.96 }), candidate: metrics({ correctness: 0.5, cost: 1 }), floors: { correctness: 0.9, safety: 0.9, authority: 0.9 } });
    const convergedProfile = { ...activePersona.persona, caution: personaRaw.changes[0]!.proposedValue, realism: personaRaw.changes[1]!.proposedValue };
    const diversity = runDeterministicCandidateGuards(personaInput, { baselineProfile: activePersona.persona, existingProfiles: [convergedProfile] });
    const overlayCaution = Math.min(0.01, Math.max(0, 1 - activePersona.persona.caution));
    const overlayRealism = Math.min(0.01, Math.max(0, 1 - activePersona.persona.realism));
    const resulting = await (await import("../../packages/persistence/src/persona-profile.js")).readActivePersonaProfile(pool, "head-engineering", "implementation", { caution: overlayCaution, realism: overlayRealism });
    const globalRows = await pool.query<{ role_id: string; profile: unknown; source: string }>("SELECT role_id, profile, source FROM persona_profile_versions");
    const concertmasterSeed = await pool.query<{ profile: unknown }>("SELECT profile FROM persona_profile_versions WHERE role_id = 'concertmaster' AND version = 1");
    const headBaselineAfter = await pool.query("SELECT version, profile, source FROM persona_profile_versions WHERE role_id = 'head-engineering' ORDER BY version DESC LIMIT 1");
    const uiExplanation = { changedAxes: personaInput.changes.map((change) => change.axis), expectedBehavior: personaInput.predictedEffect, evidence: personaInput.sourceEvidenceIds, rollback: personaInput.rollbackTarget };
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
      ["same-model evaluation is labeled", sameModel.sameModelOnly === true],
      ["low-cost regression fails hard floor", hardFloor.accepted === false],
      ["diversity collapse fails", diversity.passed === false],
      ["route regression restores exact version", routeOutcome.status === "rolled_back" && routeOutcome.activeCandidateId === routeBaseline.candidateId && routeOutcome.activeVersion === routeBaseline.version && routeOutcome.rollbackTarget.contentHash === routeBaseline.contentHash],
            ["explanation carries changed axes/effect/evidence/rollback", uiExplanation.changedAxes.length === 2 && uiExplanation.expectedBehavior.length > 0 && uiExplanation.evidence.length > 0 && uiExplanation.rollback !== undefined],
      ["project evidence is not global profile data", globalRows.rows.every((row) => !JSON.stringify(row.profile).includes(personaGoal.evidenceId) && !personaGoal.digestIds.some((digestId) => JSON.stringify(row.profile).includes(digestId)))],
      ["bounded overlay is readable and challengeable", resulting.layers.missionOverlay.caution === overlayCaution && Object.values(derivedWorkerOverlay).every((value) => value >= 0 && value <= 1) && !isMissionPersonaOverlayExpired({ expiresAt: "2026-09-14T02:00:00.000Z" }, new Date("2026-09-14T01:00:00.000Z")) && isMissionPersonaOverlayExpired({ expiresAt: "2026-09-14T00:00:00.000Z" }, new Date("2026-09-14T01:00:00.000Z")) && readChallenge.status === "open" && metronomeChallenge.evidenceReferences.includes(personaGoal.evidenceId)],
      ["same replay is deterministic and measurable", personaReplay.status === "compared" && personaReplay.results[0]!.candidate.correctness > personaReplay.results[0]!.baseline.correctness && JSON.stringify(personaReplay) === JSON.stringify(replayCandidateAgainstFrozenBaseline(personaInput, { scenarioSuite: personaInput.scenarioSuite, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, goals: [{ goalId: personaGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) }], evaluate: () => metrics({ correctness: 0.98 }) }))],
      ["shadow output changes behavior without permissions", personaShadow.result.records.length > 0 && personaShadow.result.records[0]!.matchesActive === false && personaShadow.result.liveEffects.length === 0 && JSON.stringify(personaShadow.result.records[0]!.input) === JSON.stringify(personaShadow.result.records[0]!.activeInput) && JSON.stringify(personaShadow.result.records[0]!.active.plans) === JSON.stringify(personaShadow.result.records[0]!.proposed.plans) && JSON.stringify(personaShadow.result.records[0]!.active.challenges) === JSON.stringify(personaShadow.result.records[0]!.proposed.challenges)],
    ];
    for (const [name, passed] of acceptance) expect(passed, name).toBe(true);
    const nativeReviewerOperators = await pool.query<{ operator_id: string }>("SELECT DISTINCT operator_id FROM native_execution_bindings WHERE goal_id = $1 AND admission_kind = 'encore_reviewer'", [routeGoal.goalId]);
    expect(routeEvaluationRecord.evaluationId).toMatch(/[0-9a-f-]{36}/); expect(routeCouncil.judgments).toHaveLength(2); expect(routeRollout.status).toBe("active");
    expect(routeJudged.authorId).not.toBe(routeCouncilRows.rows[0]!.model_id); expect(nativeReviewerOperators.rows).toEqual([{ operator_id: evaluatorOperatorId }]); expect(author.operatorId).not.toBe(evaluatorOperatorId); expect(routeCouncilRows.rows.map((row) => `${row.model_provider}/${row.model_id}`)).toEqual(["provider-a/model-a", "provider-b/model-b"]);
    expect(routeJudged.state).toBe("judged"); expect(routeSelection.goalRef).toBe(routeGoal.goalId); expect(routeSelection.selectedModelRef).toBe("provider/model-b"); expect(modelMapBefore).toBe(modelMapAfter); expect(globalRows.rowCount).toBeGreaterThan(0);
  });
});
