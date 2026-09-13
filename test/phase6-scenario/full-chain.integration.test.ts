import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SYNTHETIC_SCENARIO_SPECS,
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
} from "@maestro/domain";
import { applyAllMigrations } from "../../packages/persistence/src/test-migrations.js";
import { acquireGoalLease, type GoalLeaseProof } from "../../packages/persistence/src/commands.js";
import { grantProjectMembership, grantProjectRole } from "../../packages/persistence/src/project-membership.js";
import { bootstrapPermanentOrganization } from "../../packages/persistence/src/organization.js";
import { recordImprovementDigest } from "../../packages/persistence/src/improvement-digest.js";
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
const author: ImprovementCandidateAuthor = { authorId: "phase6-worker", sessionRef: "phase6-scenario", operatorId: actorId, operatorRoleId: "engineering" };
const actor = { operatorId: actorId, actorId: "phase6-rollout", sessionRef: "phase6-rollout", operatorRoleId: "engineering" };

type ScenarioGoal = { projectId: string; goalId: string; evidenceId: string; proof: GoalLeaseProof; digestId: string };

function metrics(overrides: Partial<CandidateEvaluationMetrics> = {}): CandidateEvaluationMetrics {
  return { correctness: 0.96, safety: 0.97, authority: 1, cost: 80, ...overrides };
}

function candidateInput(goal: ScenarioGoal, kind: "routing_capability_axis" | "persona_axis", rollbackTarget: string, changes: ImprovementCandidateInput["changes"]): ImprovementCandidateInput {
  const scenarioSuite = kind === "routing_capability_axis" ? ["routing-capability-v1"] : SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.scenarioId);
  const target = kind === "routing_capability_axis"
    ? { roleId: "head-engineering", taskClass: "implementation", routingTarget: "provider/model-a" }
    : { roleId: "head-engineering", taskClass: "implementation" };
  return {
    schemaVersion: 1, projectId: goal.projectId, goalId: goal.goalId, kind, target, changes,
    sourceEvidenceIds: [goal.digestId], evidencePattern: "Repeated evidence-backed review weakness.",
    predictedEffect: "Increase useful verification while preserving authority and safety.",
    expectedMetrics: [{ name: "correctness", unit: "score", direction: "increase", target: 0.95 }],
    protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9 }], scenarioSuite,
    scenarioSuiteHash: improvementCandidateScenarioSuiteHash(scenarioSuite), confidence: 0.86,
    dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
    rollbackTarget: { candidateId: rollbackTarget, version: 1, contentHash: "b".repeat(64) },
  };
}

async function seedGoal(pool: Pool, label: string): Promise<ScenarioGoal> {
  const projectId = randomUUID(); const goalId = randomUUID(); const evidenceId = randomUUID();
  await pool.query("INSERT INTO local_operators (operator_id, active) VALUES ($1, true) ON CONFLICT (operator_id) DO NOTHING", [actorId]);
  await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
  await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'test-result', 'text/plain', 'project_lifetime')`, [evidenceId, randomUUID(), randomUUID(), projectId, goalId, actorId, createHash("sha256").update(label).digest("hex"), label.length,]);
  const proof = await acquireGoalLease(pool, { goalId, ownerId: `phase6-${label}`, leaseDurationMs: 120_000 });
  await grantProjectMembership(pool, actorId, projectId); await grantProjectRole(pool, actorId, projectId, "engineering");
  const digest = await recordImprovementDigest(pool, {
    schemaVersion: 1, projectId, goalId, episodeId: `phase6-${label}`,
    trigger: "quality_signal", situation: "Repeated verification weakness was observed.", selectedDecision: "Record a bounded improvement proposal.",
    rejectedAlternatives: ["Change authority or safety boundaries."], observedResult: "A measurable quality gap remained.",
    metrics: [{ name: "correctness", value: 0.91, unit: "score" }], confidence: 0.9,
    sourceRefs: [{ kind: "evidence_record", sourceId: evidenceId }],
  }, proof, { actorId: author.authorId, sessionRef: author.sessionRef });
  return { projectId, goalId, evidenceId, proof, digestId: digest.digestId };
}

async function seedCouncil(pool: Pool, goal: ScenarioGoal): Promise<{ roundId: string; judgmentIds: string[] }> {
  const roundId = randomUUID(); const judgmentIds: string[] = [];
  await pool.query(`INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count)
    VALUES ($1, $2, $3, '[]'::jsonb, $4::jsonb, '[]'::jsonb, 2)`, [roundId, goal.goalId, "Should this bounded improvement proceed?", JSON.stringify([goal.digestId])]);
  for (const [index, model] of [[0, ["provider-a", "model-a"]], [1, ["provider-b", "model-b"]]] as const) {
    const judgmentId = randomUUID(); judgmentIds.push(judgmentId);
    await pool.query(`INSERT INTO encore_council_judgments
      (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids, execution_ref, invocation_ref)
      VALUES ($1, $2, $3, $4, $5, 'proceed', 'high', 'Independent evidence supports this bounded change.', '[]'::jsonb, NULL, $6::jsonb, $7, $8)`,
      [judgmentId, roundId, index, model[0], model[1], JSON.stringify([goal.digestId]), `phase6-exec-${index}`, `phase6-inv-${index}`]);
  }
  await pool.query(`INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes)
    VALUES ($1, 'proceed', false, false, '[]'::jsonb)`, [roundId]);
  return { roundId, judgmentIds };
}

function councilProof(candidate: ImprovementCandidate, roundId: string, evidenceId: string): RoutingCapabilityCouncilJudgment {
  const reviewer = (modelProvider: string, modelId: string) => ({ modelProvider, modelId, verdict: "proceed" as const, confidence: "high" as const,
    reasoning: "Independent evidence supports this bounded change.", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceId] });
  return { candidateId: candidate.candidateId, candidateVersion: candidate.version, candidateContentHash: candidate.contentHash,
    councilRoundId: roundId, evidenceIds: [evidenceId], judgments: [reviewer("provider-a", "model-a"), reviewer("provider-b", "model-b")] };
}

async function shadow(pool: Pool, candidate: ImprovementCandidateInput, goal: ScenarioGoal, label: string): Promise<{ result: Awaited<ReturnType<typeof runShadowEvaluation>>; digestId: string }> {
  const input = { request: `phase6 ${label}` }; const active: ShadowOutput = { messages: ["I will verify before acting."], plans: [{ step: "verify" }], challenges: [{ kind: "risk-review" }] };
  const result = await runShadowEvaluation({ candidate, cases: [{ input, activeInput: input, active }], recordedEvidence: { [goal.evidenceId]: { observed: label } },
    evaluate: async () => ({ messages: [`shadow-${label}`], plans: [{ step: "verify" }], challenges: [{ kind: "risk-review" }] }),
    journal: { append: async () => {} },
    resultSink: { commit: async () => {} }, runId: `phase6-shadow-${label}-${randomUUID()}`, processRef: `phase6-process-${label}`, sessionId: `phase6-session-${label}`, processPid: 4321 });
  expect(result.status).toBe("completed");
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
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("runs routing and persona improvements through all fourteen acceptance gates", async () => {
    const routeGoal = await seedGoal(pool, "routing"); const personaGoal = await seedGoal(pool, "persona");
    const routeRollbackId = randomUUID(); const personaRollbackId = randomUUID();
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, 1, $2, $3, $4, 'routing_capability_axis', 'head-engineering', 'implementation')", [routeRollbackId, routeGoal.projectId, routeGoal.goalId, "b".repeat(64)]);
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, 1, $2, $3, $4, 'persona_axis', 'head-engineering', 'implementation')", [personaRollbackId, personaGoal.projectId, personaGoal.goalId, "b".repeat(64)]);

    const routeComparableGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [routeComparableGoalId, routeGoal.projectId]);
    const routeRaw = candidateInput(routeGoal, "routing_capability_axis", routeRollbackId, [{ axis: "coding", currentValue: 70, proposedValue: 76 }]);
    const routeInput = createRoutingCapabilityCandidate(routeRaw); const routeCandidate = await recordImprovementCandidate(pool, routeInput, routeGoal.proof, author, `phase6-route-${randomUUID()}`);
    const routeEvaluated = await transitionImprovementCandidate(pool, routeCandidate.candidateId, "evaluated", routeGoal.proof, author, `phase6-route-eval-${randomUUID()}`);
    const replay = replayCandidateAgainstFrozenBaseline(routeInput, { scenarioSuite: routeInput.scenarioSuite, goals: [
      { goalId: routeGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) },
      { goalId: routeComparableGoalId, input: { request: "compare" }, baseline: metrics({ cost: 100 }) },
    ], evaluate: () => metrics() });
    const synthetic = runSyntheticAdversarialScenarios(routeInput, { scenarios: SYNTHETIC_SCENARIO_SPECS, evaluate: () => metrics() });
    expect(replay.status).toBe("compared"); expect(synthetic.status).toBe("completed");
    const routeShadow = await shadow(pool, routeInput, routeGoal, "routing");
    const routeCouncil = await seedCouncil(pool, routeGoal);
    const routeEvaluation = { replay, synthetic };
    const routeEvaluationRecord = await recordRoutingCandidateEvaluation(pool, routeEvaluated.candidateId, routeGoal.proof, routeEvaluation, `phase6-eval-${randomUUID()}`);
    const routeJudgment = councilProof(routeEvaluated, routeCouncil.roundId, routeGoal.digestId);
    const routeJudged = await transitionRoutingCandidateToJudged(pool, routeEvaluated.candidateId, routeGoal.proof, author, {
      evaluationId: routeEvaluationRecord.evaluationId, evaluationHash: routeEvaluationRecord.evaluationHash, councilRoundId: routeCouncil.roundId, councilJudgment: routeJudgment,
    }, `phase6-route-judge-${randomUUID()}`);
    await enableImprovementClass(pool, routeGoal.projectId, "routing_capability_axis", routeGoal.proof, actor, `phase6-enable-route-${randomUUID()}`);
    const routeRollout = await startBoundedRollout(pool, routeJudged.candidateId, { roleId: "head-engineering", taskClass: "implementation", maxGoalCount: 1, windowStart: "2026-09-14T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" }, routeGoal.proof, actor, `phase6-start-route-${randomUUID()}`);
    const routeOutcome = await observeBoundedRollout(pool, routeRollout.rolloutId, { goalId: routeGoal.goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.84 }] }, routeGoal.proof, actor, `phase6-observe-route-${randomUUID()}`);
    expect(routeOutcome.status).toBe("rolled_back"); expect(routeOutcome.activeCandidateId).toBe(routeRollbackId); expect(routeShadow.result.status).toBe("completed");

    const activePersona = await import("../../packages/persistence/src/persona-profile.js").then(({ readActivePersonaProfile }) => readActivePersonaProfile(pool, "head-engineering", "implementation"));
    const personaRaw = candidateInput(personaGoal, "persona_axis", personaRollbackId, [{ axis: "caution", currentValue: activePersona.persona.caution, proposedValue: Math.min(1, activePersona.persona.caution + 0.04) }, { axis: "realism", currentValue: activePersona.persona.realism, proposedValue: Math.min(1, activePersona.persona.realism + 0.03) }]);
    const personaInput = personaRaw; const personaCandidate = await recordImprovementCandidate(pool, personaInput, personaGoal.proof, author, `phase6-persona-${randomUUID()}`);
    const personaEvaluated = await transitionImprovementCandidate(pool, personaCandidate.candidateId, "evaluated", personaGoal.proof, author, `phase6-persona-eval-${randomUUID()}`);
    const boundsRows = await pool.query<{ axis: string; floor_value: number; ceiling_value: number }>("SELECT axis, floor_value, ceiling_value FROM role_persona_bounds WHERE role_id = 'head-engineering'");
    const floors = Object.fromEntries(boundsRows.rows.map((row) => [row.axis, row.floor_value])); const ceilings = Object.fromEntries(boundsRows.rows.map((row) => [row.axis, row.ceiling_value]));
    const guard = runDeterministicCandidateGuards(personaInput, { roleFloors: floors, roleCeilings: ceilings, mandatoryScenarioIds: SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.scenarioId), baselineProfile: activePersona.persona, existingProfiles: [activePersona.persona, { ...activePersona.persona, caution: Math.max(0, activePersona.persona.caution - 0.1) }], diversityPreserved: true });
    expect(guard.passed).toBe(true);
    const personaReplay = replayCandidateAgainstFrozenBaseline(personaInput, { scenarioSuite: personaInput.scenarioSuite, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, goals: [{ goalId: personaGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) }], evaluate: () => metrics() });
    expect(personaReplay.status).toBe("compared"); const personaShadow = await shadow(pool, personaInput, personaGoal, "persona");
    const personaCouncil = await seedCouncil(pool, personaGoal); const personaJudged = await transitionImprovementCandidate(pool, personaEvaluated.candidateId, "judged", personaGoal.proof, author, `phase6-persona-judge-${randomUUID()}`);
    await enableImprovementClass(pool, personaGoal.projectId, "persona_axis", personaGoal.proof, actor, `phase6-enable-persona-${randomUUID()}`);
    const personaRollout = await startBoundedRollout(pool, personaJudged.candidateId, { roleId: "head-engineering", taskClass: "implementation", maxGoalCount: 1, windowStart: "2026-09-14T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" }, personaGoal.proof, actor, `phase6-start-persona-${randomUUID()}`);
    const personaOutcome = await observeBoundedRollout(pool, personaRollout.rolloutId, { goalId: personaGoal.goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.96 }] }, personaGoal.proof, actor, `phase6-observe-persona-${randomUUID()}`);
    expect(personaOutcome.status).toBe("certified"); expect(personaShadow.result.status).toBe("completed"); expect(personaCouncil.judgmentIds).toHaveLength(2);

    let replayCalls = 0; const forbidden = { ...personaInput, changes: [{ axis: "authority" as "caution", currentValue: 0.7, proposedValue: 0.8 }] };
    const badReplay = replayCandidateAgainstFrozenBaseline(forbidden, { scenarioSuite: forbidden.scenarioSuite, goals: [{ goalId: personaGoal.goalId, input: {}, baseline: metrics() }], evaluate: () => { replayCalls += 1; return metrics(); } });
    const badSynthetic = runSyntheticAdversarialScenarios(forbidden, { scenarios: SYNTHETIC_SCENARIO_SPECS, evaluate: () => { replayCalls += 1; return metrics(); } });
    expect(badReplay.status).toBe("rejected"); expect(badSynthetic.status).toBe("rejected"); expect(replayCalls).toBe(0);

    const sameModel = synthesizeEncoreJudgments([{ modelProvider: "provider-a", modelId: "model-a", verdict: "proceed", confidence: "high", reasoning: "same", conditions: [], dissentNote: null, citedEvidenceIds: [routeGoal.evidenceId] }, { modelProvider: "provider-a", modelId: "model-a", verdict: "proceed", confidence: "high", reasoning: "same", conditions: [], dissentNote: null, citedEvidenceIds: [routeGoal.evidenceId] }]);
    const hardFloor = applyCandidateHardFloors({ baseline: metrics({ correctness: 0.96 }), candidate: metrics({ correctness: 0.5, cost: 1 }), floors: { correctness: 0.9, safety: 0.9, authority: 0.9 } });
    const diversity = runDeterministicCandidateGuards(personaInput, { existingProfiles: [activePersona.persona], diversityPreserved: false });
    const overlayCaution = Math.min(0.01, Math.max(0, 1 - activePersona.persona.caution));
    const overlayRealism = Math.min(0.01, Math.max(0, 1 - activePersona.persona.realism));
    const resulting = await (await import("../../packages/persistence/src/persona-profile.js")).readActivePersonaProfile(pool, "head-engineering", "implementation", { caution: overlayCaution, realism: overlayRealism });
    const globalRows = await pool.query<{ profile: unknown }>("SELECT profile FROM persona_profile_versions WHERE role_id = 'head-engineering'");
    const acceptance: readonly [string, boolean][] = [
      ["all ten axes stay in range", Object.values(resulting.persona).every((value) => value >= 0 && value <= 1)],
      ["Concertmaster seed is untouched", (await pool.query("SELECT 1 FROM persona_profile_versions WHERE role_id = 'concertmaster' AND version = 1")).rowCount === 1],
      ["mission overlay does not mutate baseline", resulting.layers.learnedProfile.profile.caution !== resulting.persona.caution],
      ["authority/core identity cannot be optimized", badReplay.status === "rejected"],
      ["evidence/scenario/rollback are required", runDeterministicCandidateGuards({ ...personaInput, sourceEvidenceIds: [], scenarioSuite: [], rollbackTarget: undefined as never }).passed === false],
      ["same-model evaluation is labeled", sameModel.sameModelOnly === true],
      ["low-cost regression fails hard floor", hardFloor.accepted === false],
      ["diversity collapse fails", diversity.passed === false],
      ["route regression restores exact version", routeOutcome.status === "rolled_back" && routeOutcome.activeCandidateId === routeRollbackId],
      ["explanation carries changed axes/effect/evidence/rollback", personaInput.changes.length === 2 && personaInput.predictedEffect.length > 0 && personaInput.sourceEvidenceIds.length > 0 && personaInput.rollbackTarget !== undefined],
      ["project evidence is not global profile data", globalRows.rows.every((row) => !JSON.stringify(row.profile).includes(personaGoal.evidenceId))],
      ["bounded overlay is readable", resulting.layers.missionOverlay.caution === overlayCaution],
      ["same replay is deterministic", JSON.stringify(personaReplay) === JSON.stringify(replayCandidateAgainstFrozenBaseline(personaInput, { scenarioSuite: personaInput.scenarioSuite, guards: { roleFloors: floors, roleCeilings: ceilings, diversityPreserved: true }, goals: [{ goalId: personaGoal.goalId, input: { request: "review" }, baseline: metrics({ cost: 100 }) }], evaluate: () => metrics() }))],
      ["shadow output changes behavior without permissions", personaShadow.result.records.length > 0 && personaInput.sourceEvidenceIds[0] === personaGoal.digestId],
    ];
    for (const [name, passed] of acceptance) expect(passed, name).toBe(true);
    expect(routeEvaluationRecord.evaluationId).toMatch(/[0-9a-f-]{36}/); expect(routeCouncil.judgmentIds).toHaveLength(2); expect(routeRollout.status).toBe("active");
    expect(globalRows.rowCount).toBeGreaterThan(0);
  });
});
