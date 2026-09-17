import { randomUUID } from "node:crypto";
import {
  CandidateRow,
  COLUMNS,
  UUID,
  authorValue,
  normalizeInput,
  operationRef,
  inputFromRow,
  mapRow,
  readRow,
  assertIdempotentReplay,
  appendFromPrevious,
} from "./shared.js";
import {
  ImprovementCandidatePersistenceError,
  type ImprovementCandidateAuthor,
  type RoutingCandidateEvaluationRecord,
  type RoutingCandidateJudgmentApproval,
} from "./types.js";

type EvaluationRow = {
  evaluation_id: string;
  candidate_id: string;
  candidate_version: number;
  candidate_content_hash: string;
  project_id: string;
  goal_id: string;
  scenario_suite_hash: string;
  evaluation_hash: string;
  replay_payload: unknown;
  synthetic_payload: unknown;
  created_at: Date;
};

function mapEvaluationRow(row: EvaluationRow): RoutingCandidateEvaluationRecord {
  return {
    evaluationId: row.evaluation_id,
    candidateId: row.candidate_id,
    candidateVersion: row.candidate_version,
    candidateContentHash: row.candidate_content_hash,
    projectId: row.project_id,
    goalId: row.goal_id,
    scenarioSuiteHash: row.scenario_suite_hash,
    evaluationHash: row.evaluation_hash,
    createdAt: row.created_at.toISOString(),
  };
}
import {
  type ImprovementCandidate,
  assertValidRoutingCandidateEvaluation,
  assertValidRoutingCapabilityCouncilJudgment,
  routingCandidateEvaluationHash,
  type RoutingCandidateEvaluationEvidence,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import type { GoalLeaseProof } from "../commands.js";
import { withGoalAuthority } from "../goal-authority.js";

/** Persist shared replay and synthetic evaluation output against an evaluated candidate. */
export async function recordRoutingCandidateEvaluation(
  pool: Pool,
  candidateId: string,
  proof: GoalLeaseProof,
  evaluation: RoutingCandidateEvaluationEvidence,
  idempotencyKey: string,
): Promise<RoutingCandidateEvaluationRecord> {
  const id = durableUuid(candidateId, "Routing evaluation candidateId");
  const operation = operationRef("evaluation", idempotencyKey);
  let evaluationHash: string;
  try {
    evaluationHash = routingCandidateEvaluationHash(evaluation);
  } catch (error) {
    throw new ImprovementCandidatePersistenceError(
      error instanceof Error ? error.message : "Routing candidate evaluation evidence is invalid",
    );
  }
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<EvaluationRow>(
      `SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, created_at
      FROM routing_candidate_evaluations WHERE operation_ref = $1 FOR UPDATE`,
      [operation],
    );
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.goal_id !== proof.goalId.toLowerCase() || row.candidate_id !== id || row.evaluation_hash !== evaluationHash) {
        throw new ImprovementCandidatePersistenceError("Routing evaluation idempotency key was reused with different content or Goal");
      }
      return mapEvaluationRow(row);
    }
    const previous = await readRow(client, id, true);
    if (previous.goal_id !== proof.goalId.toLowerCase())
      throw new ImprovementCandidatePersistenceError("Routing evaluation is outside the lease Goal");
    if (previous.kind !== "routing_capability_axis" || previous.state !== "evaluated")
      throw new ImprovementCandidatePersistenceError("Routing evaluation requires an evaluated routing candidate");
    const candidate = mapRow(previous);
    try {
      assertValidRoutingCandidateEvaluation(candidate, evaluation);
    } catch (error) {
      throw new ImprovementCandidatePersistenceError(
        error instanceof Error ? error.message : "Routing candidate evaluation evidence is invalid",
      );
    }
    const token = randomUUID();
    await client.query("SELECT set_config('maestro.routing_candidate_evaluation_token', $1, true)", [token]);
    await client.query(
      "INSERT INTO routing_candidate_evaluation_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))",
      [token],
    );
    const inserted = await client.query<EvaluationRow>(
      `INSERT INTO routing_candidate_evaluations
      (evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, operation_ref)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
      RETURNING evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, created_at`,
      [
        randomUUID(),
        previous.candidate_id,
        previous.version,
        previous.content_hash,
        previous.project_id,
        previous.goal_id,
        previous.scenario_suite_hash,
        evaluationHash,
        JSON.stringify(evaluation.replay),
        JSON.stringify(evaluation.synthetic),
        operation,
      ],
    );
    return mapEvaluationRow(inserted.rows[0]!);
  });
}

type CouncilRoundRow = {
  goal_id: string;
  evidence_ids: unknown;
  reviewer_count: number;
  final_verdict: string;
  same_model_only: boolean;
  escalated: boolean;
};
type CouncilJudgmentRow = {
  model_provider: string;
  model_id: string;
  verdict: string;
  confidence: string;
  reasoning: string;
  conditions: unknown;
  dissent_note: string | null;
  cited_evidence_ids: unknown;
};
type RollbackBindingRow = { kind: string; role_id: string | null; task_class: string | null };

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ImprovementCandidatePersistenceError(`${field} is not a durable string list`);
  }
  return value.map((item) => item.toLowerCase());
}

export function durableUuid(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!UUID.test(normalized)) throw new ImprovementCandidatePersistenceError(`${field} must be a durable UUID`);
  return normalized;
}

async function validateRoutingJudgmentApproval(
  client: PoolClient,
  previous: CandidateRow,
  approval: RoutingCandidateJudgmentApproval,
): Promise<{
  readonly evaluationId: string;
  readonly evaluationHash: string;
  readonly evaluation: RoutingCandidateEvaluationEvidence;
  readonly councilEvidenceIds: readonly string[];
}> {
  if (previous.kind !== "routing_capability_axis")
    throw new ImprovementCandidatePersistenceError("Routing judgment approval requires a routing capability candidate");
  const candidate = mapRow(previous);
  const evaluationId = durableUuid(approval.evaluationId, "Routing evaluationId");
  if (!/^[a-f0-9]{64}$/.test(approval.evaluationHash)) throw new ImprovementCandidatePersistenceError("Routing evaluationHash is invalid");
  const storedEvaluation = await client.query<EvaluationRow>(
    `SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, created_at
    FROM routing_candidate_evaluations WHERE evaluation_id = $1 FOR KEY SHARE`,
    [evaluationId],
  );
  if (storedEvaluation.rowCount !== 1)
    throw new ImprovementCandidatePersistenceError("Routing candidate evaluation is not durably recorded");
  const evaluationRow = storedEvaluation.rows[0]!;
  if (
    evaluationRow.candidate_id !== previous.candidate_id ||
    evaluationRow.candidate_version !== previous.version ||
    evaluationRow.candidate_content_hash !== previous.content_hash ||
    evaluationRow.project_id !== previous.project_id ||
    evaluationRow.goal_id !== previous.goal_id ||
    evaluationRow.scenario_suite_hash !== previous.scenario_suite_hash ||
    evaluationRow.evaluation_hash !== approval.evaluationHash
  ) {
    throw new ImprovementCandidatePersistenceError("Routing candidate evaluation is not bound to the exact candidate");
  }
  const evaluation = {
    replay: evaluationRow.replay_payload,
    synthetic: evaluationRow.synthetic_payload,
  } as RoutingCandidateEvaluationEvidence;
  try {
    assertValidRoutingCandidateEvaluation(candidate, evaluation);
  } catch (error) {
    throw new ImprovementCandidatePersistenceError(
      error instanceof Error ? error.message : "Stored routing candidate evaluation is invalid",
    );
  }
  if (routingCandidateEvaluationHash(evaluation) !== evaluationRow.evaluation_hash)
    throw new ImprovementCandidatePersistenceError("Stored routing candidate evaluation hash does not match its payload");
  if (approval.evaluationHash !== routingCandidateEvaluationHash(evaluation))
    throw new ImprovementCandidatePersistenceError("Routing candidate evaluation hash differs from the durable record");
  if (evaluation.replay.status !== "compared")
    throw new ImprovementCandidatePersistenceError("Routing candidate replay evidence is incomplete");
  const replayGoalIds = evaluation.replay.results.map((result) => result.goalId.toLowerCase());
  const replayGoals = await client.query<{ goal_id: string }>(
    "SELECT goal_id FROM goals WHERE project_id = $1 AND goal_id = ANY($2::uuid[])",
    [previous.project_id, replayGoalIds],
  );
  if (replayGoals.rowCount !== new Set(replayGoalIds).size)
    throw new ImprovementCandidatePersistenceError("Routing candidate replay Goals are outside the candidate project");
  const councilRoundId = durableUuid(approval.councilRoundId, "Routing Council roundId");
  try {
    assertValidRoutingCapabilityCouncilJudgment(candidate, approval.councilJudgment);
  } catch (error) {
    throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : "Routing Council candidate proof is invalid");
  }
  if (approval.councilJudgment.councilRoundId.toLowerCase() !== councilRoundId)
    throw new ImprovementCandidatePersistenceError("Routing Council round identity differs from the durable approval");
  const roundResult = await client.query<CouncilRoundRow>(
    `SELECT r.goal_id, r.evidence_ids, r.reviewer_count, s.final_verdict, s.same_model_only, s.escalated
    FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id
    WHERE r.round_id = $1 FOR KEY SHARE`,
    [councilRoundId],
  );
  if (roundResult.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Routing candidate Council round is not durably sealed");
  const round = roundResult.rows[0]!;
  if (
    round.goal_id !== previous.goal_id ||
    round.reviewer_count < 2 ||
    round.final_verdict !== "proceed" ||
    round.same_model_only ||
    round.escalated
  ) {
    throw new ImprovementCandidatePersistenceError("Routing candidate Council approval is outside its Goal or is not non-escalated");
  }
  const councilEvidenceIds = stringList(round.evidence_ids, "Routing Council evidence");
  const proofEvidenceIds = stringList(approval.councilJudgment.evidenceIds, "Routing Council proof evidence");
  if (councilEvidenceIds.length !== proofEvidenceIds.length || councilEvidenceIds.some((id, index) => id !== proofEvidenceIds[index])) {
    throw new ImprovementCandidatePersistenceError("Routing Council evidence differs from the exact approval proof");
  }
  const judgments = await client.query<CouncilJudgmentRow>(
    `SELECT model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids
    FROM encore_council_judgments WHERE round_id = $1 ORDER BY reviewer_index`,
    [councilRoundId],
  );
  const matched = new Set<number>();
  for (const judgment of judgments.rows) {
    if (judgment.verdict !== "proceed") throw new ImprovementCandidatePersistenceError("Routing Council contains a non-approving judgment");
    const cited = stringList(judgment.cited_evidence_ids, "Routing Council cited evidence");
    if (!previous.source_evidence_ids.every((id) => cited.includes(id.toLowerCase())))
      throw new ImprovementCandidatePersistenceError("Routing Council judgment does not cite candidate source evidence");
    const index = approval.councilJudgment.judgments.findIndex(
      (proofJudgment, proofIndex) =>
        !matched.has(proofIndex) &&
        proofJudgment.modelProvider === judgment.model_provider &&
        proofJudgment.modelId === judgment.model_id &&
        proofJudgment.verdict === judgment.verdict &&
        proofJudgment.confidence === judgment.confidence &&
        proofJudgment.reasoning === judgment.reasoning &&
        proofJudgment.dissentNote === judgment.dissent_note &&
        sameJson(proofJudgment.conditions, judgment.conditions) &&
        sameJson(proofJudgment.citedEvidenceIds, cited),
    );
    if (index < 0) throw new ImprovementCandidatePersistenceError("Routing Council judgment differs from the exact approval proof");
    matched.add(index);
  }
  if (judgments.rowCount !== round.reviewer_count || matched.size !== approval.councilJudgment.judgments.length)
    throw new ImprovementCandidatePersistenceError("Routing Council requires the complete exact reviewer set");
  const target = previous.target;
  const rollback = await client.query<RollbackBindingRow>(
    `SELECT kind, role_id, task_class
    FROM improvement_candidate_rollback_targets
    WHERE target_candidate_id = $1 AND target_version = $2 AND project_id = $3 AND goal_id = $4 AND content_hash = $5
      AND kind = 'routing_capability_axis' AND role_id = $6 AND task_class = $7`,
    [
      previous.rollback_target.candidateId,
      previous.rollback_target.version,
      previous.project_id,
      previous.goal_id,
      previous.rollback_target.contentHash,
      target.roleId,
      target.taskClass,
    ],
  );
  if (rollback.rowCount !== 1)
    throw new ImprovementCandidatePersistenceError("Routing candidate rollback target must bind kind, role, and task scope");
  return { evaluationId, evaluationHash: evaluationRow.evaluation_hash, evaluation, councilEvidenceIds };
}

async function insertRoutingCandidateApproval(
  client: PoolClient,
  candidate: ImprovementCandidate,
  previous: CandidateRow,
  approval: RoutingCandidateJudgmentApproval,
  evidence: {
    readonly evaluationId: string;
    readonly evaluationHash: string;
    readonly evaluation: RoutingCandidateEvaluationEvidence;
    readonly councilEvidenceIds: readonly string[];
  },
  operation: string,
): Promise<void> {
  const token = randomUUID();
  await client.query("SELECT set_config('maestro.routing_candidate_approval_token', $1, true)", [token]);
  await client.query(
    "INSERT INTO routing_candidate_approval_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))",
    [token],
  );
  await client.query(
    `INSERT INTO routing_candidate_approvals
    (approval_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, role_id, task_class,
     evaluation_hash, evaluation_payload, evaluation_id, replay_status, synthetic_status, council_round_id, council_evidence_ids, source_evidence_ids, council_judgment_payload,
     rollback_target_candidate_id, rollback_target_version, rollback_target_content_hash, rollback_target_kind,
     rollback_target_role_id, rollback_target_task_class, operation_ref)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, 'compared', 'completed', $12, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18, 'routing_capability_axis', $19, $20, $21)`,
    [
      randomUUID(),
      candidate.candidateId,
      candidate.version,
      candidate.contentHash,
      candidate.projectId,
      candidate.goalId,
      candidate.target.roleId,
      candidate.target.taskClass,
      evidence.evaluationHash,
      JSON.stringify(evidence.evaluation),
      evidence.evaluationId,
      durableUuid(approval.councilRoundId, "Routing Council roundId"),
      JSON.stringify(evidence.councilEvidenceIds),
      JSON.stringify(previous.source_evidence_ids),
      JSON.stringify(approval.councilJudgment),
      previous.rollback_target.candidateId,
      previous.rollback_target.version,
      previous.rollback_target.contentHash,
      candidate.target.roleId,
      candidate.target.taskClass,
      operation,
    ],
  );
}

/** Validate durable replay/Council/rollback evidence and atomically create a judged routing version. */
export async function transitionRoutingCandidateToJudged(
  pool: Pool,
  candidateId: string,
  proof: GoalLeaseProof,
  author: ImprovementCandidateAuthor,
  approval: RoutingCandidateJudgmentApproval,
  idempotencyKey: string,
): Promise<ImprovementCandidate> {
  authorValue(author);
  const operation = operationRef("transition", idempotencyKey);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [
      operation,
    ]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.goal_id !== proof.goalId.toLowerCase())
        throw new ImprovementCandidatePersistenceError("Improvement Candidate idempotency replay is outside the lease Goal");
      if (row.kind !== "routing_capability_axis" || row.state !== "judged" || row.parent_candidate_id === null)
        throw new ImprovementCandidatePersistenceError("Routing candidate judgment idempotency key was reused with different content");
      const parentId = durableUuid(candidateId, "Routing candidate parentCandidateId");
      assertIdempotentReplay(row, inputFromRow(row), author, "judged", parentId);
      const parent = await readRow(client, row.parent_candidate_id, true);
      const evidence = await validateRoutingJudgmentApproval(client, parent, approval);
      const linked = await client.query<{ evaluation_id: string; evaluation_hash: string; council_round_id: string }>(
        "SELECT evaluation_id, evaluation_hash, council_round_id FROM routing_candidate_approvals WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3",
        [row.candidate_id, row.version, row.content_hash],
      );
      if (
        linked.rowCount !== 1 ||
        linked.rows[0]!.evaluation_id !== evidence.evaluationId ||
        linked.rows[0]!.evaluation_hash !== evidence.evaluationHash ||
        linked.rows[0]!.council_round_id !== durableUuid(approval.councilRoundId, "Routing Council roundId")
      )
        throw new ImprovementCandidatePersistenceError(
          "Routing candidate judgment evidence is missing or differs from the original approval",
        );
      return mapRow(row);
    }
    const previous = await readRow(client, candidateId, true);
    if (previous.goal_id !== proof.goalId.toLowerCase())
      throw new ImprovementCandidatePersistenceError("Improvement Candidate transition is outside the lease Goal");
    if (previous.kind !== "routing_capability_axis" || previous.state !== "evaluated")
      throw new ImprovementCandidatePersistenceError("Routing candidate must be evaluated before durable Council judgment");
    const evidence = await validateRoutingJudgmentApproval(client, previous, approval);
    const judged = await appendFromPrevious(client, previous, normalizeInput(inputFromRow(previous)), proof, author, operation, "judged");
    await insertRoutingCandidateApproval(client, judged, previous, approval, evidence, operation);
    return judged;
  });
}
