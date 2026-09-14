import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  improvementCandidateScenarioSuiteHash,
  type ImprovementCandidateInput,
} from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease } from "./commands.js";
import { grantProjectMembership, grantProjectRole } from "./project-membership.js";
import { recordImprovementDigest } from "./improvement-digest.js";
import {
  appendImprovementCandidateVersion,
  listImprovementCandidateVersions,
  listImprovementCandidateArrangements,
  readImprovementCandidate,
  recordImprovementCandidate,
  recordImprovementCandidateEvaluation,
  transitionImprovementCandidate,
  type ImprovementCandidateAuthor,
} from "./improvement-candidate.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL ?? "postgresql://127.0.0.1/maestro_test";
const describeDatabase = process.env.MAESTRO_TEST_DATABASE_URL ? describe : describe.skip;
const operatorId = randomUUID();
const author: ImprovementCandidateAuthor = {
  authorId: "worker-engineering",
  sessionRef: "session:candidate",
  operatorId,
  operatorRoleId: "engineering",
};

describeDatabase("Improvement Candidate persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `candidate_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  let projectId: string;
  let goalId: string;
  let digestId: string;
  let rollbackTargetId: string;
  let proof: Awaited<ReturnType<typeof acquireGoalLease>>;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });

  beforeEach(async () => {
    projectId = randomUUID();
    goalId = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1) ON CONFLICT DO NOTHING", [operatorId]);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "engineering");
    rollbackTargetId = randomUUID();
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash) VALUES ($1, 1, $2, $3, $4)", [rollbackTargetId, projectId, goalId, "0".repeat(64)]);
    proof = await acquireGoalLease(pool, { goalId, ownerId: "candidate-worker", leaseDurationMs: 60_000 });
    const digest = await recordImprovementDigest(pool, {
      schemaVersion: 1, projectId, goalId, episodeId: `candidate-episode-${randomUUID()}`, trigger: "goal_completed",
      situation: "The bounded implementation completed with a measurable review outcome.",
      selectedDecision: "Keep the deterministic validation gate.", rejectedAlternatives: ["Skip the gate."],
      observedResult: "The required safety checks remained intact.", metrics: [{ name: "useful_findings", value: 2, unit: "count" }],
      confidence: 0.9, sourceRefs: [{ kind: "goal", sourceId: goalId }],
    }, proof, { actorId: author.authorId, sessionRef: author.sessionRef, operatorId });
    digestId = digest.digestId;
    await pool.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'improvement-digest', 'application/json', 'project_lifetime')`, [digestId, randomUUID(), randomUUID(), projectId, goalId, operatorId, digest.contentHash]);
  });

  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  const inputFor = (overrides: Partial<ImprovementCandidateInput> = {}): ImprovementCandidateInput => ({
    schemaVersion: 1, projectId, goalId, kind: "persona_axis",
    target: { roleId: "head-engineering", taskClass: "implementation" },
    changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }],
    sourceEvidenceIds: [digestId],
    evidencePattern: "Comparable Goals recorded avoidable risk-review omissions.",
    predictedEffect: "The role will surface reversible-risk checks earlier.",
    expectedMetrics: [{ name: "useful_risk_findings", unit: "count", direction: "increase", target: 1 }],
    protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9, maximum: 1 }],
    scenarioSuite: ["implementation-risk-review-v1"],
    scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["implementation-risk-review-v1"]),
    confidence: 0.84, dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
    rollbackTarget: { candidateId: rollbackTargetId, version: 1, contentHash: "0".repeat(64) },
    ...overrides,
  });

  it("stores one shared candidate shape for persona and routing targets", async () => {
    const persona = await recordImprovementCandidate(pool, inputFor({ expectedMetrics: [{ name: "correctness", unit: "score", direction: "increase", target: 1 }] }), proof, author, "persona-1");
    const routingRollbackTargetId = randomUUID();
    await pool.query("INSERT INTO improvement_candidate_rollback_targets (target_candidate_id, target_version, project_id, goal_id, content_hash, kind, role_id, task_class) VALUES ($1, 1, $2, $3, $4, 'routing_capability_axis', 'head-engineering', 'implementation')", [routingRollbackTargetId, projectId, goalId, "1".repeat(64)]);
    const routing = await recordImprovementCandidate(pool, inputFor({
      kind: "routing_capability_axis", target: { roleId: "head-engineering", taskClass: "implementation", routingTarget: "openai/gpt-5" },
      changes: [{ axis: "verification", currentValue: 120, proposedValue: 135 }],
      rollbackTarget: { candidateId: routingRollbackTargetId, version: 1, contentHash: "1".repeat(64) },
    }), proof, author, "routing-1");

    expect(persona.state).toBe("candidate");
    expect(routing.state).toBe("candidate");
    expect(await transitionImprovementCandidate(pool, persona.candidateId, "evaluated", proof, author, "persona-evaluated")).toMatchObject({ state: "evaluated", version: 2, parentCandidateId: persona.candidateId });
    const routingEvaluated = await transitionImprovementCandidate(pool, routing.candidateId, "evaluated", proof, author, "routing-evaluated");
    expect(routingEvaluated).toMatchObject({ state: "evaluated", version: 2, parentCandidateId: routing.candidateId });
    await expect(transitionImprovementCandidate(pool, routingEvaluated.candidateId, "applied", proof, author, "routing-applied")).rejects.toThrow(/proposal|auto-applied|routing/i);
    await expect(appendImprovementCandidateVersion(pool, routing.candidateId, inputFor(), proof, author, "routing-kind-switch")).rejects.toThrow(/kind|revision|routing/i);
  });

  it("rejects fabricated rollback targets and cross-Goal Improvement Digest references", async () => {
    await expect(recordImprovementCandidate(pool, inputFor({ rollbackTarget: { candidateId: randomUUID(), version: 1, contentHash: "0".repeat(64) } }), proof, author, "dangling-rollback")).rejects.toThrow(/rollback|target/i);
    await expect(recordImprovementCandidate(pool, inputFor({ sourceEvidenceIds: [randomUUID()] }), proof, author, "dangling-source")).rejects.toThrow(/digest|source|evidence/i);
    const otherGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [otherGoalId, projectId]);
    await expect(recordImprovementCandidate(pool, inputFor({ goalId: otherGoalId }), proof, author, "cross-goal")).rejects.toThrow(/Goal|lease|project/i);
  });

  it("appends immutable revisions with parent lineage and preserves the original row", async () => {
    const first = await recordImprovementCandidate(pool, inputFor(), proof, author, "revision-1");
    const second = await appendImprovementCandidateVersion(pool, first.candidateId, inputFor({ predictedEffect: "The revised role will surface checks before implementation." }), proof, author, "revision-2");
    expect(second).toMatchObject({ version: 2, parentCandidateId: first.candidateId, candidateId: expect.not.stringMatching(first.candidateId) });
    await expect(readImprovementCandidate(pool, first.candidateId, { operatorId, proof })).resolves.toEqual(first);
    await expect(listImprovementCandidateVersions(pool, first.candidateId, { operatorId, proof })).resolves.toEqual([first, second]);
    await expect(readImprovementCandidate(pool, first.candidateId, { operatorId: randomUUID(), proof })).rejects.toThrow(/authorized|project|Goal/i);
    await expect(pool.query("UPDATE improvement_candidates SET predicted_effect = 'tampered' WHERE candidate_id = $1", [first.candidateId])).rejects.toThrow(/append-only|immutable|mutation/i);
    await expect(pool.query("DELETE FROM improvement_candidates WHERE candidate_id = $1", [first.candidateId])).rejects.toThrow(/append-only|immutable|mutation/i);
    await expect(pool.query("TRUNCATE improvement_candidates")).rejects.toThrow(/truncat|forbidden|append-only/i);
    await expect(pool.query(`INSERT INTO improvement_candidates
      (candidate_id, lineage_id, version, parent_candidate_id, schema_version, project_id, goal_id, kind, target, changes,
       source_evidence_ids, evidence_pattern, predicted_effect, expected_metrics, protected_metrics, scenario_suite,
       scenario_suite_hash, confidence, data_sufficiency, rollback_target, state, content_hash, author_id,
       author_operator_id, author_role_id, session_ref, operation_ref)
      SELECT $1, lineage_id, version + 1, candidate_id, schema_version, project_id, goal_id, kind, target, changes,
       source_evidence_ids, evidence_pattern, predicted_effect, expected_metrics, protected_metrics, scenario_suite,
       scenario_suite_hash, confidence, data_sufficiency, rollback_target, 'candidate', content_hash, author_id,
       author_operator_id, author_role_id, session_ref, operation_ref || '-forged'
      FROM improvement_candidates WHERE candidate_id = $2`, [randomUUID(), first.candidateId])).rejects.toThrow(/authorization|bound|candidate insert/i);
  });

  it("replays an idempotent operation only when its content and author binding match", async () => {
    const input = inputFor();
    const first = await recordImprovementCandidate(pool, input, proof, author, "idempotent");
    await expect(recordImprovementCandidate(pool, input, proof, author, "idempotent")).resolves.toEqual(first);
    await expect(recordImprovementCandidate(pool, { ...input, predictedEffect: "different" }, proof, author, "idempotent")).rejects.toThrow(/idempotency|different|content/i);
  });

  it("rejects a persona evaluation without fixed replay, synthetic, and shadow evidence", async () => {
    const candidate = await recordImprovementCandidate(pool, inputFor(), proof, author, "evaluation-payload");
    const evaluated = await transitionImprovementCandidate(pool, candidate.candidateId, "evaluated", proof, author, "evaluation-payload-evaluated");
    await expect(recordImprovementCandidateEvaluation(pool, evaluated.candidateId, proof, { evidenceIds: [digestId], payload: {} }, "evaluation-payload-empty")).rejects.toThrow(/replay|synthetic|shadow|payload/i);
  });

  it("joins rejected candidates to their exact durable negative Council transcript", async () => {
    const initial = await recordImprovementCandidate(pool, inputFor(), proof, author, "arrangements-negative-council");
    const evaluated = await transitionImprovementCandidate(pool, initial.candidateId, "evaluated", proof, author, "arrangements-negative-council-evaluated");
    const evaluation = await recordImprovementCandidateEvaluation(pool, evaluated.candidateId, proof, {
      evidenceIds: [digestId],
      payload: {
        replay: { status: "compared", scenarioSuiteHash: evaluated.scenarioSuiteHash, results: [{ goalId, baseline: { correctness: 0.9 }, candidate: { correctness: 0.95 } }] },
        synthetic: { status: "completed", results: [{ scenarioId: "implementation-risk-review-v1", metrics: { correctness: 0.95 } }] },
        shadow: { status: "completed", records: [{ matchesActive: false }], liveEffects: [] },
      },
    }, "arrangements-negative-council-evaluation");
    const roundId = randomUUID();
    const question = `Review this evaluated improvement candidate independently.\nCandidate: ${evaluated.candidateId} version ${evaluated.version} schemaVersion ${evaluated.schemaVersion} contentHash ${evaluated.contentHash} (${evaluated.kind})`;
    await pool.query("INSERT INTO encore_council_rounds (round_id, goal_id, question, criteria, evidence_ids, trigger_reasons, reviewer_count) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, '[]'::jsonb, 2)", [roundId, goalId, question, JSON.stringify([]), JSON.stringify([digestId, evaluation.evaluationId])]);
    for (const [reviewerIndex, model] of [[0, "provider-a/model-a"], [1, "provider-b/model-b"]] as const) {
      const [modelProvider, modelId] = model.split("/");
      await pool.query("INSERT INTO encore_council_judgments (judgment_id, round_id, reviewer_index, model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids, execution_ref, invocation_ref) VALUES ($1, $2, $3, $4, $5, 'do_not_proceed', 'high', 'protected metric regression', '[]'::jsonb, NULL, $6::jsonb, $7, $8)", [randomUUID(), roundId, reviewerIndex, modelProvider, modelId, JSON.stringify([digestId, evaluation.evaluationId]), `negative-execution-${reviewerIndex}`, `negative-invocation-${reviewerIndex}`]);
    }
    await pool.query("INSERT INTO encore_council_syntheses (round_id, final_verdict, same_model_only, escalated, dissent_notes) VALUES ($1, 'do_not_proceed', false, false, '[]'::jsonb)", [roundId]);
    const rejected = await transitionImprovementCandidate(pool, evaluated.candidateId, "rejected", proof, author, "arrangements-negative-council-rejected");

    const records = await listImprovementCandidateArrangements(pool, { operatorId, projectId }, goalId);
    const record = records.find((item) => item.candidate.candidateId === rejected.candidateId);
    expect(record?.council).toMatchObject({ roundId, finalVerdict: "do_not_proceed" });
    expect(record?.council?.judgments[0]?.reasoning).toBe("protected metric regression");
  });

  it("retains every rejected version in arrangements evidence after a later retained revision", async () => {
    const rejected = await transitionImprovementCandidate(pool, (await recordImprovementCandidate(pool, inputFor(), proof, author, "arrangements-rejected" )).candidateId, "rejected", proof, author, "arrangements-rejected-transition");
    const retained = await appendImprovementCandidateVersion(pool, rejected.candidateId, inputFor({ predictedEffect: "Retain the rejected version for historical evidence." }), proof, author, "arrangements-retained-revision");
    const records = await listImprovementCandidateArrangements(pool, { operatorId, projectId }, goalId);
    expect(records.map((record) => record.candidate.candidateId)).toContain(rejected.candidateId);
    expect(records.find((record) => record.candidate.candidateId === rejected.candidateId)?.candidate.state).toBe("rejected");
    expect(records.find((record) => record.candidate.candidateId === retained.candidateId)?.candidate.state).toBe("retained");
    expect(records.find((record) => record.candidate.candidateId === rejected.candidateId)?.council).toBeNull();
  });

  it("does not replay a transition operation under another Goal lease", async () => {
    const candidate = await recordImprovementCandidate(pool, inputFor(), proof, author, "cross-goal-replay-candidate");
    const evaluated = await transitionImprovementCandidate(pool, candidate.candidateId, "evaluated", proof, author, "cross-goal-replay");
    const otherGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [otherGoalId, projectId]);
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "engineering");
    const otherProof = await acquireGoalLease(pool, { goalId: otherGoalId, ownerId: "candidate-worker-other", leaseDurationMs: 60_000 });
    await expect(transitionImprovementCandidate(pool, evaluated.candidateId, "judged", otherProof, author, "cross-goal-replay")).rejects.toThrow(/Goal|lease|replay|authorized/i);
  });

  it("requires lifecycle transitions instead of allowing a direct state skip", async () => {
    const candidate = await recordImprovementCandidate(pool, inputFor(), proof, author, "lifecycle");
    await expect(transitionImprovementCandidate(pool, candidate.candidateId, "judged", proof, author, "skip-judged")).rejects.toThrow(/transition|evaluated|state/i);
    const evaluated = await transitionImprovementCandidate(pool, candidate.candidateId, "evaluated", proof, author, "lifecycle-evaluated");
    await expect(transitionImprovementCandidate(pool, evaluated.candidateId, "judged", proof, author, "lifecycle-judged")).rejects.toThrow(/approval|Council|evaluation/i);
  });
});
