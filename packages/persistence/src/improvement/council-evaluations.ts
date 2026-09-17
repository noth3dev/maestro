import { createHash, randomUUID } from "node:crypto";
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
import { durableUuid } from "./routing-evaluations.js";
import { ImprovementCandidatePersistenceError, type ImprovementCandidateAuthor } from "./types.js";
import { canTransitionImprovementCandidate, type ImprovementCandidate, type ImprovementCandidateState } from "@maestro/domain";
import type { Pool } from "pg";
import type { GoalLeaseProof } from "../commands.js";
import { withGoalAuthority } from "../goal-authority.js";

export async function transitionImprovementCandidate(
  pool: Pool,
  candidateId: string,
  nextState: ImprovementCandidateState,
  proof: GoalLeaseProof,
  author: ImprovementCandidateAuthor,
  idempotencyKey: string,
): Promise<ImprovementCandidate> {
  authorValue(author);
  const operation = operationRef("transition", idempotencyKey);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [
      operation,
    ]);
    if (existing.rowCount === 1) {
      if (existing.rows[0]!.goal_id !== proof.goalId.toLowerCase())
        throw new ImprovementCandidatePersistenceError("Improvement Candidate idempotency replay is outside the lease Goal");
      assertIdempotentReplay(existing.rows[0]!, inputFromRow(existing.rows[0]!), author, nextState, candidateId);
      return mapRow(existing.rows[0]!);
    }
    const previous = await readRow(client, candidateId, true);
    if (previous.goal_id !== proof.goalId.toLowerCase())
      throw new ImprovementCandidatePersistenceError("Improvement Candidate transition is outside the lease Goal");
    if (previous.kind === "routing_capability_axis" && nextState === "applied")
      throw new ImprovementCandidatePersistenceError("Routing capability candidates remain proposal-only and cannot be auto-applied");
    if (previous.kind === "routing_capability_axis" && nextState === "judged")
      throw new ImprovementCandidatePersistenceError("Routing candidate requires durable replay and Council approval before judged state");
    if (previous.kind === "persona_axis" && nextState === "judged")
      throw new ImprovementCandidatePersistenceError(
        "Persona candidate requires durable replay, shadow, and Council approval before judged state",
      );
    if (!canTransitionImprovementCandidate(previous.state, nextState))
      throw new ImprovementCandidatePersistenceError(`Improvement Candidate cannot transition from ${previous.state} to ${nextState}`);
    return appendFromPrevious(client, previous, normalizeInput(inputFromRow(previous)), proof, author, operation, nextState);
  });
}

/** Durable evaluation evidence for non-routing candidate classes. */
export interface ImprovementCandidateEvaluationEvidence {
  readonly evidenceIds: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ImprovementCandidateEvaluationRecord {
  readonly evaluationId: string;
  readonly candidateId: string;
  readonly candidateVersion: number;
  readonly candidateContentHash: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly evaluationHash: string;
  readonly evidenceIds: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface ImprovementCandidateCouncilApproval {
  readonly approvalId: string;
  readonly candidateId: string;
  readonly candidateVersion: number;
  readonly candidateContentHash: string;
  readonly evaluationId: string;
  readonly evaluationHash: string;
  readonly councilRoundId: string;
  readonly councilEvidenceIds: readonly string[];
  readonly sourceEvidenceIds: readonly string[];
}

export type GenericEvaluationRow = {
  evaluation_id: string;
  candidate_id: string;
  candidate_version: number;
  candidate_content_hash: string;
  project_id: string;
  goal_id: string;
  evaluation_hash: string;
  evidence_ids: string[];
  evaluation_payload: Record<string, unknown>;
  created_at: Date;
};

export function genericEvaluationRecord(row: GenericEvaluationRow): ImprovementCandidateEvaluationRecord {
  return {
    evaluationId: row.evaluation_id,
    candidateId: row.candidate_id,
    candidateVersion: row.candidate_version,
    candidateContentHash: row.candidate_content_hash,
    projectId: row.project_id,
    goalId: row.goal_id,
    evaluationHash: row.evaluation_hash,
    evidenceIds: row.evidence_ids,
    payload: row.evaluation_payload,
    createdAt: row.created_at.toISOString(),
  };
}

function genericEvaluationHash(evidenceIds: readonly string[], payload: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(JSON.stringify({ evidenceIds, payload })).digest("hex");
}

function genericEvidenceIds(value: readonly string[]): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 32 ||
    value.some((id) => typeof id !== "string" || !UUID.test(id.trim()))
  ) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation evidence must be a bounded UUID list");
  }
  const ids = value.map((id) => id.trim().toLowerCase());
  if (new Set(ids).size !== ids.length)
    throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation evidence must be unique");
  return ids;
}

function genericPayload(value: unknown): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation payload must be a plain object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation payload must contain enumerable string fields only");
  }
  return value as Readonly<Record<string, unknown>>;
}

function evaluationObject(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new ImprovementCandidatePersistenceError(`Improvement candidate ${field} evidence is malformed`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function evaluationArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => entry === undefined)) {
    throw new ImprovementCandidatePersistenceError(`Improvement candidate ${field} evidence is incomplete`);
  }
  return value;
}

function validatePersonaEvaluationPayload(candidate: CandidateRow, payload: Readonly<Record<string, unknown>>): void {
  const keys = Object.keys(payload).sort();
  if (keys.join(",") !== "replay,shadow,synthetic")
    throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation must include replay, synthetic, and shadow evidence");
  const replay = evaluationObject(payload.replay, "replay");
  if (replay.status !== "compared" || replay.scenarioSuiteHash !== candidate.scenario_suite_hash)
    throw new ImprovementCandidatePersistenceError("Improvement candidate replay evidence is not bound to the frozen scenario suite");
  const replayResults = evaluationArray(replay.results, "replay");
  if (
    replayResults.some((entry) => {
      const row = evaluationObject(entry, "replay result");
      return (
        typeof row.goalId !== "string" ||
        evaluationObject(row.baseline, "replay baseline") === undefined ||
        evaluationObject(row.candidate, "replay candidate") === undefined
      );
    })
  )
    throw new ImprovementCandidatePersistenceError("Improvement candidate replay results are malformed");
  const measurableReplay = replayResults.some((entry) => {
    const row = entry as Record<string, unknown>;
    const baseline = row.baseline as Record<string, unknown>;
    const candidateMetrics = row.candidate as Record<string, unknown>;
    return Object.keys(candidateMetrics).some(
      (metric) =>
        typeof baseline[metric] === "number" &&
        typeof candidateMetrics[metric] === "number" &&
        baseline[metric] !== candidateMetrics[metric],
    );
  });
  if (!measurableReplay)
    throw new ImprovementCandidatePersistenceError("Improvement candidate replay evidence must show a measurable metric difference");

  const synthetic = evaluationObject(payload.synthetic, "synthetic");
  if (synthetic.status !== "completed")
    throw new ImprovementCandidatePersistenceError("Improvement candidate synthetic evidence is incomplete");
  const syntheticResults = evaluationArray(synthetic.results, "synthetic");
  const scenarioIds = new Set(syntheticResults.map((entry) => evaluationObject(entry, "synthetic result").scenarioId));
  if (
    syntheticResults.length !== candidate.scenario_suite.length ||
    candidate.scenario_suite.some((scenario) => !scenarioIds.has(scenario))
  ) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate synthetic evidence does not cover its frozen scenario suite");
  }

  const shadow = evaluationObject(payload.shadow, "shadow");
  if (shadow.status !== "completed") throw new ImprovementCandidatePersistenceError("Improvement candidate shadow evidence is incomplete");
  const shadowRecords = evaluationArray(shadow.records, "shadow");
  if (
    !Array.isArray(shadow.liveEffects) ||
    shadow.liveEffects.length !== 0 ||
    !shadowRecords.some((entry) => evaluationObject(entry, "shadow record").matchesActive === false)
  ) {
    throw new ImprovementCandidatePersistenceError(
      "Improvement candidate shadow evidence must show a zero-authority behavioral difference",
    );
  }
}

/** Records a candidate/version/hash-bound evaluation before its Council review. */
export async function recordImprovementCandidateEvaluation(
  pool: Pool,
  candidateId: string,
  proof: GoalLeaseProof,
  evaluation: ImprovementCandidateEvaluationEvidence,
  idempotencyKey: string,
): Promise<ImprovementCandidateEvaluationRecord> {
  const id = durableUuid(candidateId, "Improvement evaluation candidateId");
  const evidenceIds = genericEvidenceIds(evaluation.evidenceIds);
  const payload = genericPayload(evaluation.payload);
  if (idempotencyKey.trim() === "") throw new ImprovementCandidatePersistenceError("Improvement evaluation idempotency key is required");
  const operation = operationRef("evaluation", `generic-${idempotencyKey}`);
  const evaluationHash = genericEvaluationHash(evidenceIds, payload);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<GenericEvaluationRow>(
      `SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, created_at FROM improvement_candidate_evaluations WHERE operation_ref = $1 FOR UPDATE`,
      [operation],
    );
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.candidate_id !== id || row.goal_id !== proof.goalId.toLowerCase() || row.evaluation_hash !== evaluationHash)
        throw new ImprovementCandidatePersistenceError("Improvement evaluation idempotency key was reused with different content or Goal");
      return genericEvaluationRecord(row);
    }
    const previous = await readRow(client, id, true);
    if (previous.goal_id !== proof.goalId.toLowerCase())
      throw new ImprovementCandidatePersistenceError("Improvement evaluation is outside the lease Goal");
    if (previous.state !== "evaluated")
      throw new ImprovementCandidatePersistenceError("Improvement evaluation requires an evaluated candidate");
    if (previous.kind !== "persona_axis")
      throw new ImprovementCandidatePersistenceError("Generic improvement evaluation requires a persona candidate");
    validatePersonaEvaluationPayload(previous, payload);
    const durable = await client.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM evidence_records WHERE evidence_id = ANY($1::uuid[]) AND project_id = $2 AND goal_id = $3",
      [evidenceIds, previous.project_id, previous.goal_id],
    );
    if (Number(durable.rows[0]?.count ?? 0) !== evidenceIds.length)
      throw new ImprovementCandidatePersistenceError("Improvement evaluation evidence is missing or outside the candidate Goal");
    const evaluationId = randomUUID();
    const token = randomUUID();
    await client.query("SELECT set_config('maestro.improvement_candidate_evaluation_token', $1, true)", [token]);
    await client.query(
      "INSERT INTO improvement_candidate_evaluation_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))",
      [token],
    );
    await client.query(
      `INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'improvement-evaluation', 'application/json', 'project_lifetime')`,
      [
        evaluationId,
        randomUUID(),
        randomUUID(),
        previous.project_id,
        previous.goal_id,
        proof.ownerId,
        evaluationHash,
        JSON.stringify(payload).length,
      ],
    );
    const inserted = await client.query<GenericEvaluationRow>(
      `INSERT INTO improvement_candidate_evaluations (evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, operation_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10) RETURNING evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, created_at`,
      [
        evaluationId,
        previous.candidate_id,
        previous.version,
        previous.content_hash,
        previous.project_id,
        previous.goal_id,
        evaluationHash,
        JSON.stringify(evidenceIds),
        JSON.stringify(payload),
        operation,
      ],
    );
    return genericEvaluationRecord(inserted.rows[0]!);
  });
}

/** Persists the exact candidate-bound Council approval used by persona rollout. */
export async function recordImprovementCandidateCouncilApproval(
  pool: Pool,
  input: {
    readonly candidateId: string;
    readonly evaluationId: string;
    readonly evaluationHash: string;
    readonly councilRoundId: string;
    readonly councilEvidenceIds: readonly string[];
  },
  proof: GoalLeaseProof,
): Promise<ImprovementCandidateCouncilApproval> {
  const id = durableUuid(input.candidateId, "Improvement approval candidateId");
  const evaluationId = durableUuid(input.evaluationId, "Improvement approval evaluationId");
  const roundId = durableUuid(input.councilRoundId, "Improvement approval Council roundId");
  const councilEvidenceIds = genericEvidenceIds(input.councilEvidenceIds);
  if (!/^[0-9a-f]{64}$/.test(input.evaluationHash))
    throw new ImprovementCandidatePersistenceError("Improvement approval evaluation hash is invalid");
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const previous = await readRow(client, id, true);
    if (previous.goal_id !== proof.goalId.toLowerCase())
      throw new ImprovementCandidatePersistenceError("Improvement approval is outside the lease Goal");
    if (previous.kind !== "persona_axis" || previous.state !== "evaluated")
      throw new ImprovementCandidatePersistenceError("Improvement approval requires an evaluated persona candidate");
    const evaluation = await client.query<GenericEvaluationRow>(
      `SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, created_at FROM improvement_candidate_evaluations WHERE evaluation_id = $1`,
      [evaluationId],
    );
    if (evaluation.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Improvement approval evaluation is missing");
    const evaluated = evaluation.rows[0]!;
    if (
      evaluated.candidate_id !== id ||
      evaluated.candidate_version !== previous.version ||
      evaluated.candidate_content_hash !== previous.content_hash ||
      evaluated.project_id !== previous.project_id ||
      evaluated.goal_id !== previous.goal_id ||
      evaluated.evaluation_hash !== input.evaluationHash
    )
      throw new ImprovementCandidatePersistenceError("Improvement approval evaluation is not bound to the exact candidate version");
    if (
      evaluated.evidence_ids.some((evidenceId) => !councilEvidenceIds.includes(evidenceId)) ||
      previous.source_evidence_ids.some((evidenceId) => !councilEvidenceIds.includes(evidenceId))
    )
      throw new ImprovementCandidatePersistenceError(
        "Improvement approval Council evidence must include the candidate source and evaluation evidence",
      );
    const durableCouncilEvidence = await client.query<{ count: string }>(
      "SELECT count(*)::int AS count FROM evidence_records WHERE evidence_id = ANY($1::uuid[]) AND project_id = $2 AND goal_id = $3",
      [councilEvidenceIds, previous.project_id, previous.goal_id],
    );
    if (Number(durableCouncilEvidence.rows[0]?.count ?? 0) !== councilEvidenceIds.length)
      throw new ImprovementCandidatePersistenceError("Improvement approval Council evidence is missing or outside the candidate Goal");
    const round = await client.query<{
      goal_id: string;
      question: string;
      criteria: unknown;
      evidence_ids: string[];
      reviewer_count: number;
      final_verdict: string;
      same_model_only: boolean;
      dissent_notes: string[];
    }>(
      `SELECT r.goal_id, r.question, r.criteria, r.evidence_ids, r.reviewer_count, s.final_verdict, s.same_model_only, s.dissent_notes FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id WHERE r.round_id = $1 AND r.goal_id = $2`,
      [roundId, previous.goal_id],
    );
    if (round.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Improvement approval Council round is missing");
    const council = round.rows[0]!;
    const requiredEvidence = [...new Set([...previous.source_evidence_ids, ...evaluated.evidence_ids])];
    const criteria = Array.isArray(council.criteria) ? council.criteria : [];
    const criteriaIds = new Set(
      criteria.flatMap((item) =>
        item && typeof item === "object" && typeof (item as { criterionId?: unknown }).criterionId === "string"
          ? [(item as { criterionId: string }).criterionId]
          : [],
      ),
    );
    if (
      requiredEvidence.some((evidenceId) => !councilEvidenceIds.includes(evidenceId)) ||
      council.goal_id !== previous.goal_id ||
      !council.question.includes(`${id} version ${previous.version}`) ||
      !council.question.includes(`contentHash ${previous.content_hash}`) ||
      JSON.stringify(council.evidence_ids) !== JSON.stringify(councilEvidenceIds) ||
      !["candidate-safety", "candidate-fit", "candidate-disclosure"].every((criterionId) => criteriaIds.has(criterionId)) ||
      council.final_verdict !== "proceed" ||
      council.same_model_only ||
      council.dissent_notes.length > 0
    )
      throw new ImprovementCandidatePersistenceError("Improvement approval Council round is not an exact diverse proceed judgment");
    const judgments = await client.query<{ model_provider: string; model_id: string; verdict: string; cited_evidence_ids: string[] }>(
      "SELECT j.model_provider, j.model_id, j.verdict, j.cited_evidence_ids FROM encore_council_judgments j JOIN encore_council_rounds r ON r.round_id = j.round_id WHERE j.round_id = $1 AND r.goal_id = $2 ORDER BY j.reviewer_index",
      [roundId, previous.goal_id],
    );
    if (
      judgments.rowCount !== council.reviewer_count ||
      new Set(judgments.rows.map((row) => `${row.model_provider}/${row.model_id}`)).size < 2 ||
      judgments.rows.some(
        (row) => row.verdict !== "proceed" || JSON.stringify(row.cited_evidence_ids) !== JSON.stringify(councilEvidenceIds),
      )
    )
      throw new ImprovementCandidatePersistenceError("Improvement approval Council judgments are incomplete or not diverse");
    const existing = await client.query(
      `SELECT approval_id, candidate_id, candidate_version, candidate_content_hash, evaluation_id, evaluation_hash, council_round_id, council_evidence_ids, source_evidence_ids FROM improvement_candidate_council_approvals WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3`,
      [id, previous.version, previous.content_hash],
    );
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.evaluation_id !== evaluationId || row.evaluation_hash !== input.evaluationHash || row.council_round_id !== roundId)
        throw new ImprovementCandidatePersistenceError("Improvement approval already exists with different binding");
      return {
        approvalId: row.approval_id,
        candidateId: row.candidate_id,
        candidateVersion: row.candidate_version,
        candidateContentHash: row.candidate_content_hash,
        evaluationId: row.evaluation_id,
        evaluationHash: row.evaluation_hash,
        councilRoundId: row.council_round_id,
        councilEvidenceIds: row.council_evidence_ids,
        sourceEvidenceIds: row.source_evidence_ids,
      };
    }
    const token = randomUUID();
    await client.query("SELECT set_config('maestro.improvement_candidate_council_approval_token', $1, true)", [token]);
    await client.query(
      "INSERT INTO improvement_candidate_council_approval_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))",
      [token],
    );
    const inserted = await client.query(
      `INSERT INTO improvement_candidate_council_approvals (approval_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_id, evaluation_hash, council_round_id, council_evidence_ids, source_evidence_ids) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb) RETURNING approval_id, candidate_id, candidate_version, candidate_content_hash, evaluation_id, evaluation_hash, council_round_id, council_evidence_ids, source_evidence_ids`,
      [
        randomUUID(),
        id,
        previous.version,
        previous.content_hash,
        previous.project_id,
        previous.goal_id,
        evaluationId,
        input.evaluationHash,
        roundId,
        JSON.stringify(councilEvidenceIds),
        JSON.stringify(previous.source_evidence_ids),
      ],
    );
    const row = inserted.rows[0]!;
    return {
      approvalId: row.approval_id,
      candidateId: row.candidate_id,
      candidateVersion: row.candidate_version,
      candidateContentHash: row.candidate_content_hash,
      evaluationId: row.evaluation_id,
      evaluationHash: row.evaluation_hash,
      councilRoundId: row.council_round_id,
      councilEvidenceIds: row.council_evidence_ids,
      sourceEvidenceIds: row.source_evidence_ids,
    };
  });
}

/** Strict persona lifecycle transition; generic callers cannot skip its approval gate. */
export async function transitionImprovementCandidateAfterCouncil(
  pool: Pool,
  candidateId: string,
  proof: GoalLeaseProof,
  author: ImprovementCandidateAuthor,
  idempotencyKey: string,
): Promise<ImprovementCandidate> {
  authorValue(author);
  const operation = operationRef("transition", `after-council-${idempotencyKey}`);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [
      operation,
    ]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      const requestedId = durableUuid(candidateId, "Improvement Candidate candidateId");
      if (
        row.goal_id !== proof.goalId.toLowerCase() ||
        row.kind !== "persona_axis" ||
        row.state !== "judged" ||
        row.parent_candidate_id?.toLowerCase() !== requestedId
      ) {
        throw new ImprovementCandidatePersistenceError(
          "Improvement Candidate Council transition idempotency key was reused with different candidate or Goal",
        );
      }
      assertIdempotentReplay(row, inputFromRow(row), author, "judged", requestedId);
      const previous = await readRow(client, requestedId, true);
      if (previous.state !== "evaluated" || previous.kind !== "persona_axis")
        throw new ImprovementCandidatePersistenceError("Council-bound transition replay has no evaluated persona parent");
      const approval = await client.query(
        `SELECT 1 FROM improvement_candidate_council_approvals a JOIN improvement_candidate_evaluations e ON e.evaluation_id = a.evaluation_id AND e.candidate_id = a.candidate_id AND e.candidate_version = a.candidate_version AND e.candidate_content_hash = a.candidate_content_hash AND e.evaluation_hash = a.evaluation_hash WHERE a.candidate_id = $1 AND a.candidate_version = $2 AND a.candidate_content_hash = $3 AND a.project_id = $4 AND a.goal_id = $5`,
        [previous.candidate_id, previous.version, previous.content_hash, previous.project_id, previous.goal_id],
      );
      if (approval.rowCount !== 1)
        throw new ImprovementCandidatePersistenceError("Persona candidate Council approval is missing on idempotent replay");
      return mapRow(row);
    }
    const previous = await readRow(client, candidateId, true);
    if (previous.goal_id !== proof.goalId.toLowerCase())
      throw new ImprovementCandidatePersistenceError("Improvement Candidate transition is outside the lease Goal");
    if (previous.kind !== "persona_axis" || previous.state !== "evaluated")
      throw new ImprovementCandidatePersistenceError("Council-bound transition requires an evaluated persona candidate");
    const approval = await client.query(
      `SELECT 1 FROM improvement_candidate_council_approvals a JOIN improvement_candidate_evaluations e ON e.evaluation_id = a.evaluation_id AND e.candidate_id = a.candidate_id AND e.candidate_version = a.candidate_version AND e.candidate_content_hash = a.candidate_content_hash AND e.evaluation_hash = a.evaluation_hash WHERE a.candidate_id = $1 AND a.candidate_version = $2 AND a.candidate_content_hash = $3 AND a.project_id = $4 AND a.goal_id = $5`,
      [previous.candidate_id, previous.version, previous.content_hash, previous.project_id, previous.goal_id],
    );
    if (approval.rowCount !== 1)
      throw new ImprovementCandidatePersistenceError(
        "Persona candidate requires durable evaluation and Council approval before judged state",
      );
    return appendFromPrevious(client, previous, normalizeInput(inputFromRow(previous)), proof, author, operation, "judged");
  });
}
