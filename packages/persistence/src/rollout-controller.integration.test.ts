import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  improvementCandidateScenarioSuiteHash,
  type ImprovementCandidateInput,
  type ImprovementCandidate,
  SYNTHETIC_SCENARIO_SPECS,
  type RoutingCandidateEvaluationEvidence,
  type RoutingCapabilityCouncilJudgment,
} from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease } from "./commands.js";
import { grantProjectMembership, grantProjectRole, revokeProjectRole } from "./project-membership.js";
import { recordImprovementDigest } from "./improvement-digest.js";
import {
  recordImprovementCandidate,
  transitionImprovementCandidate,
  transitionRoutingCandidateToJudged,
  recordRoutingCandidateEvaluation,
  type ImprovementCandidateAuthor,
} from "./improvement-candidate.js";
import {
  enableImprovementClass,
  startBoundedRollout,
  observeBoundedRollout,
  interruptBoundedRollout,
  reconcileInterruptedRollout,
  reconcileExpiredBoundedRollouts,
  readBoundedRollout,
  type RolloutActor,
  type RolloutScope,
} from "./rollout-controller.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL ?? "postgresql://127.0.0.1/maestro_test";
const describeDatabase = process.env.MAESTRO_TEST_DATABASE_URL ? describe : describe.skip;
const operatorId = randomUUID();
const actor: RolloutActor = { operatorId, actorId: "rollout-worker", sessionRef: "session:rollout", operatorRoleId: "engineering" };
const candidateAuthor: ImprovementCandidateAuthor = { authorId: "worker-engineering", sessionRef: "session:candidate", operatorId, operatorRoleId: "engineering" };

function routingEvaluation(candidate: ImprovementCandidate, comparableGoalId: string): RoutingCandidateEvaluationEvidence {
  return {
    replay: {
      status: "compared",
      scenarioSuiteHash: candidate.scenarioSuiteHash,
      results: [candidate.goalId, comparableGoalId].map((goalId) => ({
        goalId,
        baseline: { correctness: 0.9, safety: 0.9, authority: 0.9, cost: 1 },
        candidate: { correctness: 0.95, safety: 0.95, authority: 0.95, cost: 1 },
      })),
    },
    synthetic: {
      status: "completed",
      results: SYNTHETIC_SCENARIO_SPECS.map((scenario) => ({
        ...scenario,
        metrics: { correctness: 0.95, safety: 0.95, authority: 0.95, cost: 1 },
      })),
    },
  };
}

function routingCouncilJudgment(candidate: ImprovementCandidate, roundId: string, digestId: string): RoutingCapabilityCouncilJudgment {
  const judgment = (modelProvider: string, modelId: string) => ({
    modelProvider, modelId, verdict: "proceed" as const, confidence: "high" as const,
    reasoning: "durable approval", conditions: [], dissentNote: null, citedEvidenceIds: [digestId],
  });
  return {
    candidateId: candidate.candidateId, candidateVersion: candidate.version, candidateContentHash: candidate.contentHash,
    councilRoundId: roundId, evidenceIds: [digestId], judgments: [judgment("provider-a", "model-a"), judgment("provider-b", "model-b")],
  };
}

 describeDatabase("bounded rollout persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `rollout_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  let projectId: string;
  let goalId: string;
  let digestId: string;
  let proof: Awaited<ReturnType<typeof acquireGoalLease>>;
  let candidate: ImprovementCandidate;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    projectId = randomUUID(); goalId = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT DO NOTHING", [operatorId]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "engineering");
    const digest = await recordImprovementDigest(pool, {
      schemaVersion: 1, projectId, goalId, episodeId: `rollout-${randomUUID()}`, trigger: "goal_completed",
      situation: "The bounded rollout has comparable evidence.", selectedDecision: "Use the measured predecessor.", rejectedAlternatives: ["Skip evidence."],
      observedResult: "Protected metrics were recorded.", metrics: [{ name: "correctness", value: 0.95, unit: "score" }], confidence: 0.9,
      sourceRefs: [{ kind: "goal", sourceId: goalId }],
    }, proof = await acquireGoalLease(pool, { goalId, ownerId: "rollout-worker", leaseDurationMs: 60_000 }), { actorId: candidateAuthor.authorId, sessionRef: candidateAuthor.sessionRef, operatorId });
    digestId = digest.digestId;
    const rollbackTargetId = randomUUID();
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, 1, $2, $3, $4, $5, $6, $7)", [rollbackTargetId, projectId, goalId, "a".repeat(64), "persona_axis", "head-engineering", "implementation"]);
    const input: ImprovementCandidateInput = {
      schemaVersion: 1, projectId, goalId, kind: "persona_axis", target: { roleId: "head-engineering", taskClass: "implementation" },
      changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }], sourceEvidenceIds: [digestId],
      evidencePattern: "Comparable Goals recorded avoidable risk-review omissions.", predictedEffect: "The role will surface reversible-risk checks earlier.",
      expectedMetrics: [{ name: "correctness", unit: "score", direction: "increase", target: 1 }], protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9 }],
      scenarioSuite: ["implementation-risk-review-v1"], scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["implementation-risk-review-v1"]), confidence: 0.84,
      dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 }, rollbackTarget: { candidateId: rollbackTargetId, version: 1, contentHash: "a".repeat(64) },
    };
    const initial = await recordImprovementCandidate(pool, input, proof, candidateAuthor, `candidate-${randomUUID()}`);
    const evaluated = await transitionImprovementCandidate(pool, initial.candidateId, "evaluated", proof, candidateAuthor, `evaluated-${randomUUID()}`);
    candidate = await transitionImprovementCandidate(pool, evaluated.candidateId, "judged", proof, candidateAuthor, `judged-${randomUUID()}`);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  const scope: RolloutScope = { roleId: "head-engineering", taskClass: "implementation", maxGoalCount: 2, windowStart: "2026-09-14T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" };

  it("denies applying a judged candidate until its exact improvement class is enabled", async () => {
    await expect(pool.query("INSERT INTO improvement_class_enablements (project_id, improvement_class, operator_id, operator_role_id, session_ref, operation_ref) VALUES ($1, 'persona_axis', $2, 'engineering', 'session:direct', $3)", [projectId, operatorId, `direct-${randomUUID()}`])).rejects.toThrow(/secured|authorization|marker/i);
    await expect(startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`)).rejects.toThrow(/enabled|class/i);
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    await expect(pool.query("DELETE FROM improvement_class_enablements WHERE project_id = $1", [projectId])).rejects.toThrow(/append-only|history|mutation/i);
    await expect(startBoundedRollout(pool, candidate.candidateId, { ...scope, taskClass: "unrelated" }, proof, actor, `start-${randomUUID()}`)).rejects.toThrow(/scope|target|task/i);
    const rollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, "same-start-key");
    await expect(startBoundedRollout(pool, candidate.candidateId, { ...scope, maxGoalCount: 3 }, proof, actor, "same-start-key")).rejects.toThrow(/idempotency|different|scope/i);
    const durationRollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, "duration-start-key", { rolloutLeaseDurationMs: 1000 });
    expect(durationRollout.status).toBe("active");
    await expect(startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, "duration-start-key", { rolloutLeaseDurationMs: 2000 })).rejects.toThrow(/idempotency|duration|different/i);
    const unauthorized = { ...actor, operatorId: randomUUID() };
    await expect(observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.95 }] }, proof, unauthorized, `unauthorized-${randomUUID()}`)).rejects.toThrow(/operator|authorized|member/i);
    const otherGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [otherGoalId, projectId]);
    const otherProof = await acquireGoalLease(pool, { goalId: otherGoalId, ownerId: "other-rollout-worker", leaseDurationMs: 60_000 });
    await expect(startBoundedRollout(pool, candidate.candidateId, scope, otherProof, actor, "same-start-key")).rejects.toThrow(/Goal|outside|lease|authorized/i);
  });

  it("keeps each enabled improvement class isolated and bounds the rollout scope", async () => {
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    const rollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`);
    await expect(observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.95 }] }, proof, actor, `observe-${randomUUID()}`)).resolves.toMatchObject({ status: "active" });
    await expect(observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T01:00:00.000Z", goalCount: 3, metrics: [{ name: "correctness", value: 0.95 }] }, proof, actor, `observe-${randomUUID()}`)).rejects.toThrow(/bound|goal|scope|already|monotonic/i);
    const routing = { ...candidate, kind: "routing_capability_axis" as const };
    await expect(enableImprovementClass(pool, projectId, "routing_capability_axis", proof, actor, `enable-routing-${randomUUID()}`)).resolves.toMatchObject({ improvementClass: "routing_capability_axis" });
    expect(routing.kind).not.toBe("persona_axis");
  });

  it("automatically rolls back a protected-metric regression without deleting evidence history", async () => {
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    const rollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`);
    const observationKey = "same-observe-key";
    const rolledBack = await observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T02:00:00.000Z", metrics: [{ name: "correctness", value: 0.84 }] }, proof, actor, observationKey);
    await expect(observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T02:00:00.000Z", metrics: [{ name: "correctness", value: 0.95 }] }, proof, actor, observationKey)).rejects.toThrow(/idempotency|different|content/i);
    await revokeProjectRole(pool, operatorId, projectId, "engineering");
    await expect(observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T02:00:00.000Z", metrics: [{ name: "correctness", value: 0.84 }] }, proof, actor, observationKey)).rejects.toThrow(/operator|authorized|member/i);
    expect(rolledBack).toMatchObject({ status: "rolled_back", activeCandidateId: candidate.rollbackTarget.candidateId, activeVersion: candidate.rollbackTarget.version, rollbackTarget: candidate.rollbackTarget });
    expect(rolledBack.sourceEvidenceIds).toContain(digestId);
    expect(rolledBack.history.some((event) => event.kind === "automatic_rollback")).toBe(true);
    await expect(readBoundedRollout(pool, rollout.rolloutId, { operatorId, proof })).resolves.toMatchObject({ status: "rolled_back", sourceEvidenceIds: [digestId] });
  });

  it("reconciles an owner-expired active rollout during startup without an explicit interrupt", async () => {
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    const rollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`, { rolloutLeaseDurationMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T01:00:00.000Z", metrics: [{ name: "correctness", value: 0.95 }] }, proof, actor, `expired-observe-${randomUUID()}`)).rejects.toThrow(/expired|lease|owner/i);
    await expect(reconcileExpiredBoundedRollouts(pool, proof, actor)).resolves.toEqual([expect.objectContaining({ rolloutId: rollout.rolloutId, status: "rolled_back", activeCandidateId: candidate.rollbackTarget.candidateId, activeVersion: candidate.rollbackTarget.version })]);
  });

  it("runs a routing capability candidate through bounded rollback without mutating the human model baseline", async () => {
    const routingRollbackTargetId = randomUUID();
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, 1, $2, $3, $4, $5, $6, $7)", [routingRollbackTargetId, projectId, goalId, "b".repeat(64), "routing_capability_axis", "head-engineering", "implementation"]);
    const routingInput: ImprovementCandidateInput = {
      schemaVersion: 1, projectId, goalId, kind: "routing_capability_axis", target: { roleId: "head-engineering", taskClass: "implementation", routingTarget: "provider/fast" },
      changes: [{ axis: "coding", currentValue: 120, proposedValue: 140 }], sourceEvidenceIds: [digestId],
      evidencePattern: "Comparable Goals show a repeatable coding verification gap.", predictedEffect: "The local proposal can be evaluated without changing model_map.",
      expectedMetrics: [{ name: "verification_failures", unit: "count", direction: "decrease", target: 0 }], protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9 }],
      scenarioSuite: ["routing-capability-v1"], scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["routing-capability-v1"]), confidence: 0.84,
      dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 }, rollbackTarget: { candidateId: routingRollbackTargetId, version: 1, contentHash: "b".repeat(64) },
    };
    const comparableGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [comparableGoalId, projectId]);
    const roundId = randomUUID();
    await pool.query(`INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count)
      VALUES ($1, $2, 'Should the bounded routing proposal proceed?', '[]'::jsonb, $3::jsonb, '[]'::jsonb, 2)`, [roundId, goalId, JSON.stringify([digestId])]);
    for (const [index, model] of [[0, ["provider-a", "model-a"]], [1, ["provider-b", "model-b"]]] as const) {
      await pool.query(`INSERT INTO encore_council_judgments
        (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, cited_evidence_ids, execution_ref, invocation_ref)
        VALUES ($1, $2, $3, $4, $5, 'proceed', 'high', 'durable approval', '[]'::jsonb, $6::jsonb, $7, $8)`,
        [randomUUID(), roundId, index, model[0], model[1], JSON.stringify([digestId]), `execution-${index}`, `invocation-${index}`]);
    }
    await pool.query(`INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes)
      VALUES ($1, 'proceed', false, false, '[]'::jsonb)`, [roundId]);
    const initial = await recordImprovementCandidate(pool, routingInput, proof, candidateAuthor, `routing-candidate-${randomUUID()}`);
    const evaluated = await transitionImprovementCandidate(pool, initial.candidateId, "evaluated", proof, candidateAuthor, `routing-evaluated-${randomUUID()}`);
    await expect(transitionImprovementCandidate(pool, evaluated.candidateId, "judged", proof, candidateAuthor, `routing-bypass-${randomUUID()}`)).rejects.toThrow(/durable|Council|approval|evidence/i);
    const evaluation = routingEvaluation(evaluated, comparableGoalId);
    const evaluationRecord = await recordRoutingCandidateEvaluation(pool, evaluated.candidateId, proof, evaluation, `routing-evaluation-${randomUUID()}`);
    const judgedKey = `routing-judged-${randomUUID()}`;
    const judgedApproval = { evaluationId: evaluationRecord.evaluationId, evaluationHash: evaluationRecord.evaluationHash, councilRoundId: roundId, councilJudgment: routingCouncilJudgment(evaluated, roundId, digestId) };
    const judged = await transitionRoutingCandidateToJudged(pool, evaluated.candidateId, proof, candidateAuthor, judgedApproval, judgedKey);
    await expect(transitionRoutingCandidateToJudged(pool, evaluated.candidateId, proof, candidateAuthor, judgedApproval, judgedKey)).resolves.toMatchObject({ candidateId: judged.candidateId, state: "judged" });
    await expect(transitionRoutingCandidateToJudged(pool, evaluated.candidateId, proof, candidateAuthor, { ...judgedApproval, evaluationHash: "f".repeat(64) }, judgedKey)).rejects.toThrow(/differs|evidence|hash|bound/i);
    await enableImprovementClass(pool, projectId, "routing_capability_axis", proof, actor, `enable-routing-${randomUUID()}`);

    const rollout = await startBoundedRollout(pool, judged.candidateId, scope, proof, actor, `routing-start-${randomUUID()}`);
    const rolledBack = await observeBoundedRollout(pool, rollout.rolloutId, { goalId, observedAt: "2026-09-14T02:00:00.000Z", metrics: [{ name: "correctness", value: 0.84 }] }, proof, actor, `routing-observe-${randomUUID()}`);

    expect(rolledBack).toMatchObject({ status: "rolled_back", activeCandidateId: routingRollbackTargetId, activeVersion: 1, sourceEvidenceIds: [digestId] });
    expect(rolledBack.history.some((event) => event.kind === "automatic_rollback")).toBe(true);
    await expect(readBoundedRollout(pool, rollout.rolloutId, { operatorId, proof })).resolves.toMatchObject({ status: "rolled_back", sourceEvidenceIds: [digestId] });
  });

  it("reconciles an interrupted rollout to the last certified state using its durable rollback target", async () => {
    await enableImprovementClass(pool, projectId, "persona_axis", proof, actor, `enable-${randomUUID()}`);
    const rollout = await startBoundedRollout(pool, candidate.candidateId, scope, proof, actor, `start-${randomUUID()}`);
    const interrupted = await interruptBoundedRollout(pool, rollout.rolloutId, proof, actor, `interrupt-${randomUUID()}`);
    expect(interrupted).toMatchObject({ status: "interrupted", activeCandidateId: candidate.candidateId, rollbackTarget: candidate.rollbackTarget });
    const reconcileKey = "same-reconcile-key";
    await expect(reconcileInterruptedRollout(pool, rollout.rolloutId, proof, actor, reconcileKey)).resolves.toMatchObject({ status: "rolled_back", activeCandidateId: candidate.rollbackTarget.candidateId, activeVersion: candidate.rollbackTarget.version, rollbackTarget: candidate.rollbackTarget });
    await revokeProjectRole(pool, operatorId, projectId, "engineering");
    await expect(reconcileInterruptedRollout(pool, rollout.rolloutId, proof, actor, reconcileKey)).rejects.toThrow(/operator|authorized|member/i);
  });
});
