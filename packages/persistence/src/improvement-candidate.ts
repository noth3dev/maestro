import { randomUUID } from "node:crypto";
import {
  assertSafeImprovementDigestText,
  canTransitionImprovementCandidate,
  improvementCandidateContentHash,
  assertValidImprovementCandidateInput,
  materializeImprovementCandidate,
  type ImprovementCandidate,
  type ImprovementCandidateIdentity,
  type ImprovementCandidateInput,
  type ImprovementCandidateState,
  assertValidRoutingCandidateEvaluation,
  assertValidRoutingCapabilityCouncilJudgment,
  routingCandidateEvaluationHash,
  type RoutingCandidateEvaluationEvidence,
  type RoutingCapabilityCouncilJudgment,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";

export class ImprovementCandidatePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImprovementCandidatePersistenceError";
  }
}
export class ImprovementCandidateNotFoundError extends ImprovementCandidatePersistenceError {}

export interface ImprovementCandidateAuthor {
  readonly authorId: string;
  readonly sessionRef: string;
  readonly operatorId: string;
  readonly operatorRoleId: string;
}

/** Durable evidence required to move a routing candidate into the judged state. */
export interface RoutingCandidateJudgmentApproval {
  readonly evaluationId: string;
  readonly evaluationHash: string;
  readonly councilRoundId: string;
  readonly councilJudgment: RoutingCapabilityCouncilJudgment;
}

export interface RoutingCandidateEvaluationRecord {
  readonly evaluationId: string;
  readonly candidateId: string;
  readonly candidateVersion: number;
  readonly candidateContentHash: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly scenarioSuiteHash: string;
  readonly evaluationHash: string;
  readonly createdAt: string;
}

export interface ImprovementCandidateReadAuthorization {
  readonly operatorId: string;
  readonly proof: GoalLeaseProof;
}

interface CandidateRow {
  candidate_id: string;
  lineage_id: string;
  version: number;
  parent_candidate_id: string | null;
  schema_version: number;
  project_id: string;
  goal_id: string;
  kind: ImprovementCandidateInput["kind"];
  target: ImprovementCandidateInput["target"];
  changes: ImprovementCandidateInput["changes"];
  source_evidence_ids: string[];
  evidence_pattern: string;
  predicted_effect: string;
  expected_metrics: ImprovementCandidateInput["expectedMetrics"];
  protected_metrics: ImprovementCandidateInput["protectedMetrics"];
  scenario_suite: string[];
  scenario_suite_hash: string;
  confidence: number | string;
  data_sufficiency: ImprovementCandidateInput["dataSufficiency"];
  rollback_target: ImprovementCandidateInput["rollbackTarget"];
  state: ImprovementCandidateState;
  content_hash: string;
  author_id: string;
  author_operator_id: string;
  author_role_id: string;
  session_ref: string;
  operation_ref: string;
  created_at: Date;
}

const COLUMNS = `candidate_id, lineage_id, version, parent_candidate_id, schema_version, project_id, goal_id, kind,
  target, changes, source_evidence_ids, evidence_pattern, predicted_effect, expected_metrics, protected_metrics,
  scenario_suite, scenario_suite_hash, confidence, data_sufficiency, rollback_target, state, content_hash,
  author_id, author_operator_id, author_role_id, session_ref, operation_ref, created_at`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function line(value: unknown, field: string, maximum = 256): asserts value is string {
  try {
    assertSafeImprovementDigestText(value, field, maximum);
  } catch (error) {
    throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : `${field} is invalid`);
  }
  if (/\r|\n/.test(value)) throw new ImprovementCandidatePersistenceError(`${field} must be a single line`);
}

function authorValue(author: ImprovementCandidateAuthor): void {
  line(author?.authorId, "Improvement Candidate authorId");
  line(author?.sessionRef, "Improvement Candidate sessionRef");
  line(author?.operatorRoleId, "Improvement Candidate operatorRoleId");
  line(author?.operatorId, "Improvement Candidate operatorId");
  if (!UUID.test(author.operatorId)) throw new ImprovementCandidatePersistenceError("Improvement Candidate operatorId must be a durable UUID");
}

function normalizeInput(input: ImprovementCandidateInput): ImprovementCandidateInput {
  try {
    assertValidImprovementCandidateInput(input);
  } catch (error) {
    throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : "Improvement Candidate input is invalid");
  }
  return {
    ...input,
    projectId: input.projectId.toLowerCase(),
    goalId: input.goalId.toLowerCase(),
    target: { ...input.target },
    changes: input.changes.map((change) => ({ ...change })),
    sourceEvidenceIds: input.sourceEvidenceIds.map((id) => id.toLowerCase()),
    expectedMetrics: input.expectedMetrics.map((metric) => ({ ...metric })),
    protectedMetrics: input.protectedMetrics.map((metric) => ({ ...metric })),
    scenarioSuite: [...input.scenarioSuite],
    rollbackTarget: { ...input.rollbackTarget, candidateId: input.rollbackTarget.candidateId.toLowerCase() },
    dataSufficiency: { ...input.dataSufficiency },
  };
}

function operationRef(kind: "record" | "append" | "transition" | "evaluation", idempotencyKey: string): string {
  const prefix = `candidate:${kind}:`;
  line(idempotencyKey, "Improvement Candidate idempotencyKey", 256 - prefix.length);
  return `${prefix}${idempotencyKey.trim()}`;
}

function inputFromRow(row: CandidateRow): ImprovementCandidateInput {
  return {
    schemaVersion: 1,
    projectId: row.project_id,
    goalId: row.goal_id,
    kind: row.kind,
    target: row.target,
    changes: row.changes,
    sourceEvidenceIds: row.source_evidence_ids,
    evidencePattern: row.evidence_pattern,
    predictedEffect: row.predicted_effect,
    expectedMetrics: row.expected_metrics,
    protectedMetrics: row.protected_metrics,
    scenarioSuite: row.scenario_suite,
    scenarioSuiteHash: row.scenario_suite_hash.trim(),
    confidence: Number(row.confidence),
    dataSufficiency: row.data_sufficiency,
    rollbackTarget: row.rollback_target,
  };
}

function mapRow(row: CandidateRow): ImprovementCandidate {
  try {
    const input = inputFromRow(row);
    const identity: ImprovementCandidateIdentity = {
      candidateId: row.candidate_id,
      version: row.version,
      parentCandidateId: row.parent_candidate_id,
      state: row.state,
      authorId: row.author_id,
      sessionRef: row.session_ref,
      createdAt: row.created_at.toISOString(),
    };
    const candidate = materializeImprovementCandidate(input, identity);
    if (candidate.contentHash !== row.content_hash.trim()) throw new ImprovementCandidatePersistenceError("Stored Improvement Candidate content hash does not match its input");
    if (candidate.contentHash.length !== 64) throw new ImprovementCandidatePersistenceError("Stored Improvement Candidate content hash is invalid");
    return candidate;
  } catch (error) {
    if (error instanceof ImprovementCandidatePersistenceError) throw error;
    throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : "Stored Improvement Candidate is invalid");
  }
}

async function assertReadAccess(pool: Pool, row: CandidateRow, authorization: ImprovementCandidateReadAuthorization): Promise<void> {
  line(authorization?.operatorId, "Improvement Candidate read operatorId");
  if (!UUID.test(authorization.operatorId)) throw new ImprovementCandidatePersistenceError("Improvement Candidate read operatorId must be a durable UUID");
  if (authorization.proof?.goalId?.toLowerCase() !== row.goal_id || authorization.proof.ownerId === "" || !/^\d+$/.test(authorization.proof.fencingToken)) {
    throw new ImprovementCandidatePersistenceError("Improvement Candidate read lease proof is invalid");
  }
  const result = await pool.query(
    `SELECT 1
       FROM local_operators o
       JOIN operator_project_memberships m ON m.operator_id = o.operator_id AND m.project_id = $2 AND m.active = true
       JOIN goal_leases l ON l.goal_id = $3 AND l.owner_id = $4 AND l.fencing_token = $5::bigint AND l.expires_at > clock_timestamp()
      WHERE o.operator_id = $1 AND o.active = true`,
    [authorization.operatorId, row.project_id, row.goal_id, authorization.proof.ownerId, authorization.proof.fencingToken],
  );
  if (result.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Improvement Candidate read is not authorized for this project and Goal");
}

async function readRow(client: Pick<Pool | PoolClient, "query">, candidateId: string, forUpdate = false): Promise<CandidateRow> {
  line(candidateId, "Improvement Candidate candidateId");
  if (!UUID.test(candidateId)) throw new ImprovementCandidatePersistenceError("Improvement Candidate candidateId must be a durable UUID");
  const result = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE candidate_id = $1${forUpdate ? " FOR UPDATE" : ""}`, [candidateId.toLowerCase()]);
  if (result.rowCount !== 1) throw new ImprovementCandidateNotFoundError(`Improvement Candidate not found: ${candidateId}`);
  return result.rows[0]!;
}

function payload(input: ImprovementCandidateInput): Record<string, unknown> {
  return {
    schemaVersion: input.schemaVersion,
    projectId: input.projectId,
    goalId: input.goalId,
    kind: input.kind,
    target: input.target,
    changes: input.changes,
    sourceEvidenceIds: input.sourceEvidenceIds,
    evidencePattern: input.evidencePattern,
    predictedEffect: input.predictedEffect,
    expectedMetrics: input.expectedMetrics,
    protectedMetrics: input.protectedMetrics,
    scenarioSuite: input.scenarioSuite,
    scenarioSuiteHash: input.scenarioSuiteHash,
    confidence: input.confidence,
    dataSufficiency: input.dataSufficiency,
    rollbackTarget: input.rollbackTarget,
  };
}

function assertIdempotentReplay(row: CandidateRow, input: ImprovementCandidateInput, author: ImprovementCandidateAuthor, state: ImprovementCandidateState, parentCandidateId?: string): void {
  if (row.content_hash.trim() !== improvementCandidateContentHash(input)
      || row.author_id !== author.authorId.trim()
      || row.author_operator_id.toLowerCase() !== author.operatorId.toLowerCase()
      || row.author_role_id !== author.operatorRoleId.trim()
      || row.state !== state
      || (parentCandidateId !== undefined && row.parent_candidate_id?.toLowerCase() !== parentCandidateId.toLowerCase())) {
    throw new ImprovementCandidatePersistenceError("Improvement Candidate idempotency key was reused with different content");
  }
}

async function insertCandidate(
  client: PoolClient,
  input: ImprovementCandidateInput,
  proof: GoalLeaseProof,
  author: ImprovementCandidateAuthor,
  operation: string,
  identity: { readonly candidateId: string; readonly lineageId: string; readonly version: number; readonly parentCandidateId: string | null; readonly state: ImprovementCandidateState },
): Promise<ImprovementCandidate> {
  const candidate = materializeImprovementCandidate(input, {
    candidateId: identity.candidateId,
    version: identity.version,
    parentCandidateId: identity.parentCandidateId,
    state: identity.state,
    authorId: author.authorId.trim(),
    sessionRef: author.sessionRef.trim(),
    createdAt: new Date().toISOString(),
  });
  const authorized = await client.query<{ authorize_improvement_candidate_insert: string }>(
    "SELECT authorize_improvement_candidate_insert($1, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9, $10, $11::bigint, $12, $13, $14, $15::jsonb) AS authorize_improvement_candidate_insert",
    [randomUUID(), candidate.candidateId, identity.lineageId, candidate.version, candidate.parentCandidateId, input.projectId, input.goalId, author.operatorId, author.operatorRoleId, proof.ownerId, proof.fencingToken, operation, candidate.state, candidate.contentHash, JSON.stringify(payload(input))],
  );
  const canonicalHash = authorized.rows[0]?.authorize_improvement_candidate_insert;
  if (canonicalHash === undefined || canonicalHash.trim() !== candidate.contentHash) throw new ImprovementCandidatePersistenceError("Database candidate content hash does not match the canonical input");
  const inserted = await client.query<CandidateRow>(
    `INSERT INTO improvement_candidates
      (candidate_id, lineage_id, version, parent_candidate_id, schema_version, project_id, goal_id, kind,
       target, changes, source_evidence_ids, evidence_pattern, predicted_effect, expected_metrics, protected_metrics,
       scenario_suite, scenario_suite_hash, confidence, data_sufficiency, rollback_target, state, content_hash,
       author_id, author_operator_id, author_role_id, session_ref, operation_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15::jsonb,
       $16::jsonb, $17, $18, $19::jsonb, $20::jsonb, $21, $22, $23, $24, $25, $26, $27)
     RETURNING ${COLUMNS}`,
    [candidate.candidateId, identity.lineageId, candidate.version, candidate.parentCandidateId, input.schemaVersion, input.projectId, input.goalId, input.kind,
      JSON.stringify(input.target), JSON.stringify(input.changes), JSON.stringify(input.sourceEvidenceIds), input.evidencePattern, input.predictedEffect, JSON.stringify(input.expectedMetrics), JSON.stringify(input.protectedMetrics),
      JSON.stringify(input.scenarioSuite), input.scenarioSuiteHash, input.confidence, JSON.stringify(input.dataSufficiency), JSON.stringify(input.rollbackTarget), candidate.state, candidate.contentHash,
      candidate.authorId, author.operatorId, author.operatorRoleId, candidate.sessionRef, operation],
  );
  return mapRow(inserted.rows[0]!);
}

function ensureProofMatches(input: ImprovementCandidateInput, proof: GoalLeaseProof): void {
  if (input.goalId !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Improvement Candidate Goal does not match its lease proof");
}

/** Record the initial candidate version. The sourceEvidenceIds are durable Improvement Digest ids. */
export async function recordImprovementCandidate(pool: Pool, rawInput: ImprovementCandidateInput, proof: GoalLeaseProof, author: ImprovementCandidateAuthor, idempotencyKey: string): Promise<ImprovementCandidate> {
  const input = normalizeInput(rawInput);
  authorValue(author);
  ensureProofMatches(input, proof);
  const operation = operationRef("record", idempotencyKey);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [operation]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      assertIdempotentReplay(row, input, author, "candidate");
      return mapRow(row);
    }
    const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [input.goalId]);
    if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== input.projectId) throw new ImprovementCandidatePersistenceError("Improvement Candidate Goal/project binding is invalid");
    const candidateId = randomUUID();
    return insertCandidate(client, input, proof, author, operation, { candidateId, lineageId: candidateId, version: 1, parentCandidateId: null, state: "candidate" });
  });
}

export async function readImprovementCandidate(pool: Pool, candidateId: string, authorization: ImprovementCandidateReadAuthorization): Promise<ImprovementCandidate> {
  const row = await readRow(pool, candidateId);
  await assertReadAccess(pool, row, authorization);
  return mapRow(row);
}

export async function listImprovementCandidateVersions(pool: Pool, candidateId: string, authorization: ImprovementCandidateReadAuthorization): Promise<readonly ImprovementCandidate[]> {
  const first = await readRow(pool, candidateId);
  await assertReadAccess(pool, first, authorization);
  const result = await pool.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE lineage_id = $1 ORDER BY version`, [first.lineage_id]);
  return result.rows.map(mapRow);
}

async function appendFromPrevious(
  client: PoolClient,
  previous: CandidateRow,
  input: ImprovementCandidateInput,
  proof: GoalLeaseProof,
  author: ImprovementCandidateAuthor,
  operation: string,
  state: ImprovementCandidateState,
): Promise<ImprovementCandidate> {
  if (input.projectId !== previous.project_id || input.goalId !== previous.goal_id) throw new ImprovementCandidatePersistenceError("Improvement Candidate revision cannot change project or Goal");
  if (input.kind !== previous.kind) throw new ImprovementCandidatePersistenceError("Improvement Candidate revision cannot change candidate kind");
  const candidateId = randomUUID();
  return insertCandidate(client, input, proof, author, operation, { candidateId, lineageId: previous.lineage_id, version: previous.version + 1, parentCandidateId: previous.candidate_id, state });
}

export async function appendImprovementCandidateVersion(pool: Pool, candidateId: string, rawInput: ImprovementCandidateInput, proof: GoalLeaseProof, author: ImprovementCandidateAuthor, idempotencyKey: string): Promise<ImprovementCandidate> {
  const input = normalizeInput(rawInput);
  authorValue(author);
  ensureProofMatches(input, proof);
  const operation = operationRef("append", idempotencyKey);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [operation]);
    if (existing.rowCount === 1) {
      assertIdempotentReplay(existing.rows[0]!, input, author, "candidate", candidateId);
      return mapRow(existing.rows[0]!);
    }
    const previous = await readRow(client, candidateId, true);
    return appendFromPrevious(client, previous, input, proof, author, operation, "candidate");
  });
}

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
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const previous = await readRow(client, id, true);
    if (previous.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Routing evaluation is outside the lease Goal");
    if (previous.kind !== "routing_capability_axis" || previous.state !== "evaluated") throw new ImprovementCandidatePersistenceError("Routing evaluation requires an evaluated routing candidate");
    const candidate = mapRow(previous);
    try { assertValidRoutingCandidateEvaluation(candidate, evaluation); }
    catch (error) { throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : "Routing candidate evaluation evidence is invalid"); }
    const evaluationHash = routingCandidateEvaluationHash(evaluation);
    const existing = await client.query<EvaluationRow>(`SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, created_at
      FROM routing_candidate_evaluations WHERE operation_ref = $1 FOR UPDATE`, [operation]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.candidate_id !== previous.candidate_id || row.candidate_version !== previous.version || row.candidate_content_hash !== previous.content_hash || row.evaluation_hash !== evaluationHash) {
        throw new ImprovementCandidatePersistenceError("Routing evaluation idempotency key was reused with different content");
      }
      return mapEvaluationRow(row);
    }
    const token = randomUUID();
    await client.query("SELECT set_config('maestro.routing_candidate_evaluation_token', $1, true)", [token]);
    await client.query("INSERT INTO routing_candidate_evaluation_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))", [token]);
    const inserted = await client.query<EvaluationRow>(`INSERT INTO routing_candidate_evaluations
      (evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, operation_ref)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
      RETURNING evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, created_at`, [
      randomUUID(), previous.candidate_id, previous.version, previous.content_hash, previous.project_id, previous.goal_id,
      previous.scenario_suite_hash, evaluationHash, JSON.stringify(evaluation.replay), JSON.stringify(evaluation.synthetic), operation,
    ]);
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
type CouncilJudgmentRow = { model_provider: string; model_id: string; verdict: string; confidence: string; reasoning: string; conditions: unknown; dissent_note: string | null; cited_evidence_ids: unknown };
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

function durableUuid(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!UUID.test(normalized)) throw new ImprovementCandidatePersistenceError(`${field} must be a durable UUID`);
  return normalized;
}

async function validateRoutingJudgmentApproval(
  client: PoolClient,
  previous: CandidateRow,
  approval: RoutingCandidateJudgmentApproval,
): Promise<{ readonly evaluationId: string; readonly evaluationHash: string; readonly evaluation: RoutingCandidateEvaluationEvidence; readonly councilEvidenceIds: readonly string[] }> {
  if (previous.kind !== "routing_capability_axis") throw new ImprovementCandidatePersistenceError("Routing judgment approval requires a routing capability candidate");
  const candidate = mapRow(previous);
  const evaluationId = durableUuid(approval.evaluationId, "Routing evaluationId");
  if (!/^[a-f0-9]{64}$/.test(approval.evaluationHash)) throw new ImprovementCandidatePersistenceError("Routing evaluationHash is invalid");
  const storedEvaluation = await client.query<EvaluationRow>(`SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, created_at
    FROM routing_candidate_evaluations WHERE evaluation_id = $1 FOR KEY SHARE`, [evaluationId]);
  if (storedEvaluation.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Routing candidate evaluation is not durably recorded");
  const evaluationRow = storedEvaluation.rows[0]!;
  if (evaluationRow.candidate_id !== previous.candidate_id || evaluationRow.candidate_version !== previous.version
      || evaluationRow.candidate_content_hash !== previous.content_hash || evaluationRow.project_id !== previous.project_id
      || evaluationRow.goal_id !== previous.goal_id || evaluationRow.scenario_suite_hash !== previous.scenario_suite_hash
      || evaluationRow.evaluation_hash !== approval.evaluationHash) {
    throw new ImprovementCandidatePersistenceError("Routing candidate evaluation is not bound to the exact candidate");
  }
  const evaluation = { replay: evaluationRow.replay_payload, synthetic: evaluationRow.synthetic_payload } as RoutingCandidateEvaluationEvidence;
  try { assertValidRoutingCandidateEvaluation(candidate, evaluation); }
  catch (error) { throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : "Stored routing candidate evaluation is invalid"); }
  if (routingCandidateEvaluationHash(evaluation) !== evaluationRow.evaluation_hash) throw new ImprovementCandidatePersistenceError("Stored routing candidate evaluation hash does not match its payload");
  if (approval.evaluationHash !== routingCandidateEvaluationHash(evaluation)) throw new ImprovementCandidatePersistenceError("Routing candidate evaluation hash differs from the durable record");
  if (evaluation.replay.status !== "compared") throw new ImprovementCandidatePersistenceError("Routing candidate replay evidence is incomplete");
  const replayGoalIds = evaluation.replay.results.map((result) => result.goalId.toLowerCase());
  const replayGoals = await client.query<{ goal_id: string }>("SELECT goal_id FROM goals WHERE project_id = $1 AND goal_id = ANY($2::uuid[])", [previous.project_id, replayGoalIds]);
  if (replayGoals.rowCount !== new Set(replayGoalIds).size) throw new ImprovementCandidatePersistenceError("Routing candidate replay Goals are outside the candidate project");
  const councilRoundId = durableUuid(approval.councilRoundId, "Routing Council roundId");
  try { assertValidRoutingCapabilityCouncilJudgment(candidate, approval.councilJudgment); }
  catch (error) { throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : "Routing Council candidate proof is invalid"); }
  if (approval.councilJudgment.councilRoundId.toLowerCase() !== councilRoundId) throw new ImprovementCandidatePersistenceError("Routing Council round identity differs from the durable approval");
  const roundResult = await client.query<CouncilRoundRow>(`SELECT r.goal_id, r.evidence_ids, r.reviewer_count, s.final_verdict, s.same_model_only, s.escalated
    FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id
    WHERE r.round_id = $1 FOR KEY SHARE`, [councilRoundId]);
  if (roundResult.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Routing candidate Council round is not durably sealed");
  const round = roundResult.rows[0]!;
  if (round.goal_id !== previous.goal_id || round.reviewer_count < 2 || round.final_verdict !== "proceed" || round.same_model_only || round.escalated) {
    throw new ImprovementCandidatePersistenceError("Routing candidate Council approval is outside its Goal or is not non-escalated");
  }
  const councilEvidenceIds = stringList(round.evidence_ids, "Routing Council evidence");
  const proofEvidenceIds = stringList(approval.councilJudgment.evidenceIds, "Routing Council proof evidence");
  if (councilEvidenceIds.length !== proofEvidenceIds.length || councilEvidenceIds.some((id, index) => id !== proofEvidenceIds[index])) {
    throw new ImprovementCandidatePersistenceError("Routing Council evidence differs from the exact approval proof");
  }
  const judgments = await client.query<CouncilJudgmentRow>(`SELECT model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids
    FROM encore_council_judgments WHERE round_id = $1 ORDER BY reviewer_index`, [councilRoundId]);
  const matched = new Set<number>();
  for (const judgment of judgments.rows) {
    if (judgment.verdict !== "proceed") throw new ImprovementCandidatePersistenceError("Routing Council contains a non-approving judgment");
    const cited = stringList(judgment.cited_evidence_ids, "Routing Council cited evidence");
    if (!previous.source_evidence_ids.every((id) => cited.includes(id.toLowerCase()))) throw new ImprovementCandidatePersistenceError("Routing Council judgment does not cite candidate source evidence");
    const index = approval.councilJudgment.judgments.findIndex((proofJudgment, proofIndex) => !matched.has(proofIndex)
      && proofJudgment.modelProvider === judgment.model_provider && proofJudgment.modelId === judgment.model_id
      && proofJudgment.verdict === judgment.verdict && proofJudgment.confidence === judgment.confidence
      && proofJudgment.reasoning === judgment.reasoning && proofJudgment.dissentNote === judgment.dissent_note
      && sameJson(proofJudgment.conditions, judgment.conditions) && sameJson(proofJudgment.citedEvidenceIds, cited));
    if (index < 0) throw new ImprovementCandidatePersistenceError("Routing Council judgment differs from the exact approval proof");
    matched.add(index);
  }
  if (judgments.rowCount !== round.reviewer_count || matched.size !== approval.councilJudgment.judgments.length) throw new ImprovementCandidatePersistenceError("Routing Council requires the complete exact reviewer set");
  const target = previous.target;
  const rollback = await client.query<RollbackBindingRow>(`SELECT kind, role_id, task_class
    FROM improvement_candidate_rollback_targets
    WHERE target_candidate_id = $1 AND target_version = $2 AND project_id = $3 AND goal_id = $4 AND content_hash = $5
      AND kind = 'routing_capability_axis' AND role_id = $6 AND task_class = $7`, [
    previous.rollback_target.candidateId, previous.rollback_target.version, previous.project_id, previous.goal_id,
    previous.rollback_target.contentHash, target.roleId, target.taskClass,
  ]);
  if (rollback.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Routing candidate rollback target must bind kind, role, and task scope");
  return { evaluationId, evaluationHash: evaluationRow.evaluation_hash, evaluation, councilEvidenceIds };
}

async function insertRoutingCandidateApproval(
  client: PoolClient,
  candidate: ImprovementCandidate,
  previous: CandidateRow,
  approval: RoutingCandidateJudgmentApproval,
  evidence: { readonly evaluationId: string; readonly evaluationHash: string; readonly evaluation: RoutingCandidateEvaluationEvidence; readonly councilEvidenceIds: readonly string[] },
  operation: string,
): Promise<void> {
  const token = randomUUID();
  await client.query("SELECT set_config('maestro.routing_candidate_approval_token', $1, true)", [token]);
  await client.query("INSERT INTO routing_candidate_approval_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))", [token]);
  await client.query(`INSERT INTO routing_candidate_approvals
    (approval_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, role_id, task_class,
     evaluation_hash, evaluation_payload, evaluation_id, replay_status, synthetic_status, council_round_id, council_evidence_ids, source_evidence_ids, council_judgment_payload,
     rollback_target_candidate_id, rollback_target_version, rollback_target_content_hash, rollback_target_kind,
     rollback_target_role_id, rollback_target_task_class, operation_ref)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, 'compared', 'completed', $12, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18, 'routing_capability_axis', $19, $20, $21)`, [
    randomUUID(), candidate.candidateId, candidate.version, candidate.contentHash, candidate.projectId, candidate.goalId,
    candidate.target.roleId, candidate.target.taskClass, evidence.evaluationHash, JSON.stringify(evidence.evaluation), evidence.evaluationId,
    durableUuid(approval.councilRoundId, "Routing Council roundId"), JSON.stringify(evidence.councilEvidenceIds), JSON.stringify(previous.source_evidence_ids), JSON.stringify(approval.councilJudgment),
    previous.rollback_target.candidateId, previous.rollback_target.version, previous.rollback_target.contentHash, candidate.target.roleId, candidate.target.taskClass, operation,
  ]);
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
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [operation]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Improvement Candidate idempotency replay is outside the lease Goal");
      if (row.kind !== "routing_capability_axis" || row.state !== "judged" || row.parent_candidate_id === null) throw new ImprovementCandidatePersistenceError("Routing candidate judgment idempotency key was reused with different content");
      const parentId = durableUuid(candidateId, "Routing candidate parentCandidateId");
      assertIdempotentReplay(row, inputFromRow(row), author, "judged", parentId);
      const parent = await readRow(client, row.parent_candidate_id, true);
      const evidence = await validateRoutingJudgmentApproval(client, parent, approval);
      const linked = await client.query<{ evaluation_id: string; evaluation_hash: string; council_round_id: string }>("SELECT evaluation_id, evaluation_hash, council_round_id FROM routing_candidate_approvals WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3", [row.candidate_id, row.version, row.content_hash]);
      if (linked.rowCount !== 1 || linked.rows[0]!.evaluation_id !== evidence.evaluationId || linked.rows[0]!.evaluation_hash !== evidence.evaluationHash || linked.rows[0]!.council_round_id !== durableUuid(approval.councilRoundId, "Routing Council roundId")) throw new ImprovementCandidatePersistenceError("Routing candidate judgment evidence is missing or differs from the original approval");
      return mapRow(row);
    }
    const previous = await readRow(client, candidateId, true);
    if (previous.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Improvement Candidate transition is outside the lease Goal");
    if (previous.kind !== "routing_capability_axis" || previous.state !== "evaluated") throw new ImprovementCandidatePersistenceError("Routing candidate must be evaluated before durable Council judgment");
    const evidence = await validateRoutingJudgmentApproval(client, previous, approval);
    const judged = await appendFromPrevious(client, previous, normalizeInput(inputFromRow(previous)), proof, author, operation, "judged");
    await insertRoutingCandidateApproval(client, judged, previous, approval, evidence, operation);
    return judged;
  });
}

export async function transitionImprovementCandidate(pool: Pool, candidateId: string, nextState: ImprovementCandidateState, proof: GoalLeaseProof, author: ImprovementCandidateAuthor, idempotencyKey: string): Promise<ImprovementCandidate> {
  authorValue(author);
  const operation = operationRef("transition", idempotencyKey);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [operation]);
    if (existing.rowCount === 1) {
      if (existing.rows[0]!.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Improvement Candidate idempotency replay is outside the lease Goal");
      assertIdempotentReplay(existing.rows[0]!, inputFromRow(existing.rows[0]!), author, nextState, candidateId);
      return mapRow(existing.rows[0]!);
    }
    const previous = await readRow(client, candidateId, true);
    if (previous.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Improvement Candidate transition is outside the lease Goal");
    if (previous.kind === "routing_capability_axis" && nextState === "applied") throw new ImprovementCandidatePersistenceError("Routing capability candidates remain proposal-only and cannot be auto-applied");
    if (previous.kind === "routing_capability_axis" && nextState === "judged") throw new ImprovementCandidatePersistenceError("Routing candidate requires durable replay and Council approval before judged state");
    if (!canTransitionImprovementCandidate(previous.state, nextState)) throw new ImprovementCandidatePersistenceError(`Improvement Candidate cannot transition from ${previous.state} to ${nextState}`);
    return appendFromPrevious(client, previous, normalizeInput(inputFromRow(previous)), proof, author, operation, nextState);
  });
}
