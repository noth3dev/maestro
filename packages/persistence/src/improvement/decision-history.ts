import { type ImprovementCandidate, type ImprovementCandidateInput } from "@maestro/domain";
import type { Pool } from "pg";
import { type ImprovementCandidateReadAuthorization } from "./types.js";
import {
  type GenericEvaluationRow,
  genericEvaluationRecord,
  type ImprovementCandidateCouncilApproval,
  type ImprovementCandidateEvaluationRecord,
} from "./council-evaluations.js";
import { readImprovementCandidate } from "./candidates.js";

export interface ImprovementCandidateDecisionHistory {
  readonly candidate: ImprovementCandidate;
  readonly evaluation: ImprovementCandidateEvaluationRecord | null;
  readonly approval: ImprovementCandidateCouncilApproval | null;
  readonly council: Readonly<{
    roundId: string;
    question: string;
    criteria: unknown;
    evidenceIds: readonly string[];
    reviewerCount: number;
    finalVerdict: string;
    sameModelOnly: boolean;
    dissentNotes: readonly string[];
    judgments: readonly Readonly<Record<string, unknown>>[];
  }> | null;
  readonly rollouts: readonly Readonly<{
    rolloutId: string;
    status: string;
    activeCandidateId: string;
    activeVersion: number;
    history: readonly Readonly<Record<string, unknown>>[];
  }>[];
  readonly explanation: Readonly<{
    changedAxes: readonly string[];
    expectedBehavior: string;
    evidenceIds: readonly string[];
    rollback: ImprovementCandidateInput["rollbackTarget"];
  }>;
}

/** Read-only projection used by user-facing history views; all fields come from durable records. */
export async function readImprovementCandidateDecisionHistory(
  pool: Pool,
  candidateId: string,
  authorization: ImprovementCandidateReadAuthorization,
): Promise<ImprovementCandidateDecisionHistory> {
  const candidate = await readImprovementCandidate(pool, candidateId, authorization);
  const evaluatedId = candidate.state === "evaluated" ? candidate.candidateId : (candidate.parentCandidateId ?? candidate.candidateId);
  const evaluatedVersion = candidate.state === "evaluated" ? candidate.version : Math.max(1, candidate.version - 1);
  const evaluatedHash =
    candidate.state === "evaluated"
      ? candidate.contentHash
      : (
          await pool.query<{ content_hash: string }>("SELECT content_hash FROM improvement_candidates WHERE candidate_id = $1", [
            evaluatedId,
          ])
        ).rows[0]?.content_hash;
  const evaluated = await pool.query<GenericEvaluationRow>(
    `SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, created_at FROM improvement_candidate_evaluations WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3 AND project_id = $4 AND goal_id = $5`,
    [evaluatedId, evaluatedVersion, evaluatedHash, candidate.projectId, candidate.goalId],
  );
  const evaluation = evaluated.rowCount === 1 ? genericEvaluationRecord(evaluated.rows[0]!) : null;
  const approvalRow = await pool.query<{
    approval_id: string;
    candidate_id: string;
    candidate_version: number;
    candidate_content_hash: string;
    evaluation_id: string;
    evaluation_hash: string;
    council_round_id: string;
    council_evidence_ids: string[];
    source_evidence_ids: string[];
  }>(
    `SELECT approval_id, candidate_id, candidate_version, candidate_content_hash, evaluation_id, evaluation_hash, council_round_id, council_evidence_ids, source_evidence_ids FROM improvement_candidate_council_approvals WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3`,
    [evaluatedId, evaluatedVersion, evaluation?.candidateContentHash ?? evaluatedHash ?? ""],
  );
  const approval =
    approvalRow.rowCount === 1
      ? {
          approvalId: approvalRow.rows[0]!.approval_id,
          candidateId: approvalRow.rows[0]!.candidate_id,
          candidateVersion: approvalRow.rows[0]!.candidate_version,
          candidateContentHash: approvalRow.rows[0]!.candidate_content_hash,
          evaluationId: approvalRow.rows[0]!.evaluation_id,
          evaluationHash: approvalRow.rows[0]!.evaluation_hash,
          councilRoundId: approvalRow.rows[0]!.council_round_id,
          councilEvidenceIds: approvalRow.rows[0]!.council_evidence_ids,
          sourceEvidenceIds: approvalRow.rows[0]!.source_evidence_ids,
        }
      : null;
  let council: ImprovementCandidateDecisionHistory["council"] = null;
  if (approval !== null) {
    const round = await pool.query<{
      round_id: string;
      question: string;
      criteria: unknown;
      evidence_ids: string[];
      reviewer_count: number;
      final_verdict: string;
      same_model_only: boolean;
      dissent_notes: string[];
    }>(
      `SELECT r.round_id, r.question, r.criteria, r.evidence_ids, r.reviewer_count, s.final_verdict, s.same_model_only, s.dissent_notes FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id WHERE r.round_id = $1`,
      [approval.councilRoundId],
    );
    const judgments = await pool.query<Record<string, unknown>>(
      "SELECT model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids FROM encore_council_judgments WHERE round_id = $1 ORDER BY reviewer_index",
      [approval.councilRoundId],
    );
    if (round.rowCount === 1) {
      const row = round.rows[0]!;
      council = {
        roundId: row.round_id,
        question: row.question,
        criteria: row.criteria,
        evidenceIds: row.evidence_ids,
        reviewerCount: row.reviewer_count,
        finalVerdict: row.final_verdict,
        sameModelOnly: row.same_model_only,
        dissentNotes: row.dissent_notes,
        judgments: judgments.rows,
      };
    }
  }
  const rollouts = await pool.query<{ rollout_id: string; status: string; active_candidate_id: string; active_version: number }>(
    "SELECT r.rollout_id, r.status, r.active_candidate_id, r.active_version FROM improvement_rollouts r JOIN improvement_candidates c ON c.candidate_id = r.candidate_id WHERE c.lineage_id = (SELECT lineage_id FROM improvement_candidates WHERE candidate_id = $1) ORDER BY r.created_at, r.rollout_id",
    [candidate.candidateId],
  );
  const rolloutHistory: Array<ImprovementCandidateDecisionHistory["rollouts"][number]> = [];
  for (const row of rollouts.rows) {
    const events = await pool.query<Record<string, unknown>>(
      "SELECT event_id, kind, details, created_at FROM improvement_rollout_events WHERE rollout_id = $1 ORDER BY created_at, event_id",
      [row.rollout_id],
    );
    rolloutHistory.push({
      rolloutId: row.rollout_id,
      status: row.status,
      activeCandidateId: row.active_candidate_id,
      activeVersion: row.active_version,
      history: events.rows,
    });
  }
  return {
    candidate,
    evaluation,
    approval,
    council,
    rollouts: rolloutHistory,
    explanation: {
      changedAxes: candidate.changes.map((change) => change.axis),
      expectedBehavior: candidate.predictedEffect,
      evidenceIds: [
        ...new Set([...candidate.sourceEvidenceIds, ...(evaluation?.evidenceIds ?? []), ...(approval?.councilEvidenceIds ?? [])]),
      ],
      rollback: candidate.rollbackTarget,
    },
  };
}
