import { createHash, randomUUID } from "node:crypto";
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
import { assertProjectMembership } from "./project-membership.js";

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
  if (input.target.roleId !== previous.target.roleId || input.target.taskClass !== previous.target.taskClass) throw new ImprovementCandidatePersistenceError("Improvement Candidate revision cannot change target role or task class");
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
  let evaluationHash: string;
  try { evaluationHash = routingCandidateEvaluationHash(evaluation); }
  catch (error) { throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : "Routing candidate evaluation evidence is invalid"); }
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<EvaluationRow>(`SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, scenario_suite_hash, evaluation_hash, replay_payload, synthetic_payload, created_at
      FROM routing_candidate_evaluations WHERE operation_ref = $1 FOR UPDATE`, [operation]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.goal_id !== proof.goalId.toLowerCase() || row.candidate_id !== id || row.evaluation_hash !== evaluationHash) {
        throw new ImprovementCandidatePersistenceError("Routing evaluation idempotency key was reused with different content or Goal");
      }
      return mapEvaluationRow(row);
    }
    const previous = await readRow(client, id, true);
    if (previous.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Routing evaluation is outside the lease Goal");
    if (previous.kind !== "routing_capability_axis" || previous.state !== "evaluated") throw new ImprovementCandidatePersistenceError("Routing evaluation requires an evaluated routing candidate");
    const candidate = mapRow(previous);
    try { assertValidRoutingCandidateEvaluation(candidate, evaluation); }
    catch (error) { throw new ImprovementCandidatePersistenceError(error instanceof Error ? error.message : "Routing candidate evaluation evidence is invalid"); }
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
    if (previous.kind === "persona_axis" && nextState === "judged") throw new ImprovementCandidatePersistenceError("Persona candidate requires durable replay, shadow, and Council approval before judged state");
    if (!canTransitionImprovementCandidate(previous.state, nextState)) throw new ImprovementCandidatePersistenceError(`Improvement Candidate cannot transition from ${previous.state} to ${nextState}`);
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

type GenericEvaluationRow = {
  evaluation_id: string; candidate_id: string; candidate_version: number; candidate_content_hash: string;
  project_id: string; goal_id: string; evaluation_hash: string; evidence_ids: string[];
  evaluation_payload: Record<string, unknown>; created_at: Date;
};

function genericEvaluationRecord(row: GenericEvaluationRow): ImprovementCandidateEvaluationRecord {
  return { evaluationId: row.evaluation_id, candidateId: row.candidate_id, candidateVersion: row.candidate_version,
    candidateContentHash: row.candidate_content_hash, projectId: row.project_id, goalId: row.goal_id,
    evaluationHash: row.evaluation_hash, evidenceIds: row.evidence_ids, payload: row.evaluation_payload,
    createdAt: row.created_at.toISOString() };
}

function genericEvaluationHash(evidenceIds: readonly string[], payload: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(JSON.stringify({ evidenceIds, payload })).digest("hex");
}

function genericEvidenceIds(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32 || value.some((id) => typeof id !== "string" || !UUID.test(id.trim()))) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation evidence must be a bounded UUID list");
  }
  const ids = value.map((id) => id.trim().toLowerCase());
  if (new Set(ids).size !== ids.length) throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation evidence must be unique");
  return ids;
}

function genericPayload(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation payload must be a plain object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation payload must contain enumerable string fields only");
  }
  return value as Readonly<Record<string, unknown>>;
}

function evaluationObject(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
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
  if (keys.join(",") !== "replay,shadow,synthetic") throw new ImprovementCandidatePersistenceError("Improvement candidate evaluation must include replay, synthetic, and shadow evidence");
  const replay = evaluationObject(payload.replay, "replay");
  if (replay.status !== "compared" || replay.scenarioSuiteHash !== candidate.scenario_suite_hash) throw new ImprovementCandidatePersistenceError("Improvement candidate replay evidence is not bound to the frozen scenario suite");
  const replayResults = evaluationArray(replay.results, "replay");
  if (replayResults.some((entry) => {
    const row = evaluationObject(entry, "replay result");
    return typeof row.goalId !== "string" || evaluationObject(row.baseline, "replay baseline") === undefined || evaluationObject(row.candidate, "replay candidate") === undefined;
  })) throw new ImprovementCandidatePersistenceError("Improvement candidate replay results are malformed");
  const measurableReplay = replayResults.some((entry) => {
    const row = entry as Record<string, unknown>;
    const baseline = row.baseline as Record<string, unknown>;
    const candidateMetrics = row.candidate as Record<string, unknown>;
    return Object.keys(candidateMetrics).some((metric) => typeof baseline[metric] === "number" && typeof candidateMetrics[metric] === "number" && baseline[metric] !== candidateMetrics[metric]);
  });
  if (!measurableReplay) throw new ImprovementCandidatePersistenceError("Improvement candidate replay evidence must show a measurable metric difference");

  const synthetic = evaluationObject(payload.synthetic, "synthetic");
  if (synthetic.status !== "completed") throw new ImprovementCandidatePersistenceError("Improvement candidate synthetic evidence is incomplete");
  const syntheticResults = evaluationArray(synthetic.results, "synthetic");
  const scenarioIds = new Set(syntheticResults.map((entry) => evaluationObject(entry, "synthetic result").scenarioId));
  if (syntheticResults.length !== candidate.scenario_suite.length || candidate.scenario_suite.some((scenario) => !scenarioIds.has(scenario))) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate synthetic evidence does not cover its frozen scenario suite");
  }

  const shadow = evaluationObject(payload.shadow, "shadow");
  if (shadow.status !== "completed") throw new ImprovementCandidatePersistenceError("Improvement candidate shadow evidence is incomplete");
  const shadowRecords = evaluationArray(shadow.records, "shadow");
  if (!Array.isArray(shadow.liveEffects) || shadow.liveEffects.length !== 0 || !shadowRecords.some((entry) => evaluationObject(entry, "shadow record").matchesActive === false)) {
    throw new ImprovementCandidatePersistenceError("Improvement candidate shadow evidence must show a zero-authority behavioral difference");
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
    const existing = await client.query<GenericEvaluationRow>(`SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, created_at FROM improvement_candidate_evaluations WHERE operation_ref = $1 FOR UPDATE`, [operation]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.candidate_id !== id || row.goal_id !== proof.goalId.toLowerCase() || row.evaluation_hash !== evaluationHash) throw new ImprovementCandidatePersistenceError("Improvement evaluation idempotency key was reused with different content or Goal");
      return genericEvaluationRecord(row);
    }
    const previous = await readRow(client, id, true);
    if (previous.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Improvement evaluation is outside the lease Goal");
    if (previous.state !== "evaluated") throw new ImprovementCandidatePersistenceError("Improvement evaluation requires an evaluated candidate");
    if (previous.kind !== "persona_axis") throw new ImprovementCandidatePersistenceError("Generic improvement evaluation requires a persona candidate");
    validatePersonaEvaluationPayload(previous, payload);
    const durable = await client.query<{ count: string }>("SELECT count(*)::int AS count FROM evidence_records WHERE evidence_id = ANY($1::uuid[]) AND project_id = $2 AND goal_id = $3", [evidenceIds, previous.project_id, previous.goal_id]);
    if (Number(durable.rows[0]?.count ?? 0) !== evidenceIds.length) throw new ImprovementCandidatePersistenceError("Improvement evaluation evidence is missing or outside the candidate Goal");
    const evaluationId = randomUUID();
    const token = randomUUID();
    await client.query("SELECT set_config('maestro.improvement_candidate_evaluation_token', $1, true)", [token]);
    await client.query("INSERT INTO improvement_candidate_evaluation_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))", [token]);
    await client.query(`INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'improvement-evaluation', 'application/json', 'project_lifetime')`, [evaluationId, randomUUID(), randomUUID(), previous.project_id, previous.goal_id, proof.ownerId, evaluationHash, JSON.stringify(payload).length]);
    const inserted = await client.query<GenericEvaluationRow>(`INSERT INTO improvement_candidate_evaluations (evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, operation_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10) RETURNING evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, created_at`, [evaluationId, previous.candidate_id, previous.version, previous.content_hash, previous.project_id, previous.goal_id, evaluationHash, JSON.stringify(evidenceIds), JSON.stringify(payload), operation]);
    return genericEvaluationRecord(inserted.rows[0]!);
  });
}

/** Persists the exact candidate-bound Council approval used by persona rollout. */
export async function recordImprovementCandidateCouncilApproval(
  pool: Pool,
  input: { readonly candidateId: string; readonly evaluationId: string; readonly evaluationHash: string; readonly councilRoundId: string; readonly councilEvidenceIds: readonly string[] },
  proof: GoalLeaseProof,
): Promise<ImprovementCandidateCouncilApproval> {
  const id = durableUuid(input.candidateId, "Improvement approval candidateId");
  const evaluationId = durableUuid(input.evaluationId, "Improvement approval evaluationId");
  const roundId = durableUuid(input.councilRoundId, "Improvement approval Council roundId");
  const councilEvidenceIds = genericEvidenceIds(input.councilEvidenceIds);
  if (!/^[0-9a-f]{64}$/.test(input.evaluationHash)) throw new ImprovementCandidatePersistenceError("Improvement approval evaluation hash is invalid");
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const previous = await readRow(client, id, true);
    if (previous.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Improvement approval is outside the lease Goal");
    if (previous.kind !== "persona_axis" || previous.state !== "evaluated") throw new ImprovementCandidatePersistenceError("Improvement approval requires an evaluated persona candidate");
    const evaluation = await client.query<GenericEvaluationRow>(`SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, created_at FROM improvement_candidate_evaluations WHERE evaluation_id = $1`, [evaluationId]);
    if (evaluation.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Improvement approval evaluation is missing");
    const evaluated = evaluation.rows[0]!;
    if (evaluated.candidate_id !== id || evaluated.candidate_version !== previous.version || evaluated.candidate_content_hash !== previous.content_hash || evaluated.project_id !== previous.project_id || evaluated.goal_id !== previous.goal_id || evaluated.evaluation_hash !== input.evaluationHash) throw new ImprovementCandidatePersistenceError("Improvement approval evaluation is not bound to the exact candidate version");
    if (evaluated.evidence_ids.some((evidenceId) => !councilEvidenceIds.includes(evidenceId)) || previous.source_evidence_ids.some((evidenceId) => !councilEvidenceIds.includes(evidenceId))) throw new ImprovementCandidatePersistenceError("Improvement approval Council evidence must include the candidate source and evaluation evidence");
    const durableCouncilEvidence = await client.query<{ count: string }>("SELECT count(*)::int AS count FROM evidence_records WHERE evidence_id = ANY($1::uuid[]) AND project_id = $2 AND goal_id = $3", [councilEvidenceIds, previous.project_id, previous.goal_id]);
    if (Number(durableCouncilEvidence.rows[0]?.count ?? 0) !== councilEvidenceIds.length) throw new ImprovementCandidatePersistenceError("Improvement approval Council evidence is missing or outside the candidate Goal");
    const round = await client.query<{ goal_id: string; question: string; criteria: unknown; evidence_ids: string[]; reviewer_count: number; final_verdict: string; same_model_only: boolean; dissent_notes: string[] }>(`SELECT r.goal_id, r.question, r.criteria, r.evidence_ids, r.reviewer_count, s.final_verdict, s.same_model_only, s.dissent_notes FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id WHERE r.round_id = $1 AND r.goal_id = $2`, [roundId, previous.goal_id]);
    if (round.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Improvement approval Council round is missing");
    const council = round.rows[0]!;
    const requiredEvidence = [...new Set([...previous.source_evidence_ids, ...evaluated.evidence_ids])];
    const criteria = Array.isArray(council.criteria) ? council.criteria : [];
    const criteriaIds = new Set(criteria.flatMap((item) => item && typeof item === "object" && typeof (item as { criterionId?: unknown }).criterionId === "string" ? [(item as { criterionId: string }).criterionId] : []));
    if (requiredEvidence.some((evidenceId) => !councilEvidenceIds.includes(evidenceId))
        || council.goal_id !== previous.goal_id
        || !council.question.includes(`${id} version ${previous.version}`)
        || !council.question.includes(`contentHash ${previous.content_hash}`)
        || JSON.stringify(council.evidence_ids) !== JSON.stringify(councilEvidenceIds)
        || !["candidate-safety", "candidate-fit", "candidate-disclosure"].every((criterionId) => criteriaIds.has(criterionId))
        || council.final_verdict !== "proceed" || council.same_model_only || council.dissent_notes.length > 0) throw new ImprovementCandidatePersistenceError("Improvement approval Council round is not an exact diverse proceed judgment");
    const judgments = await client.query<{ model_provider: string; model_id: string; verdict: string; cited_evidence_ids: string[] }>("SELECT j.model_provider, j.model_id, j.verdict, j.cited_evidence_ids FROM encore_council_judgments j JOIN encore_council_rounds r ON r.round_id = j.round_id WHERE j.round_id = $1 AND r.goal_id = $2 ORDER BY j.reviewer_index", [roundId, previous.goal_id]);
    if (judgments.rowCount !== council.reviewer_count || new Set(judgments.rows.map((row) => `${row.model_provider}/${row.model_id}`)).size < 2 || judgments.rows.some((row) => row.verdict !== "proceed" || JSON.stringify(row.cited_evidence_ids) !== JSON.stringify(councilEvidenceIds))) throw new ImprovementCandidatePersistenceError("Improvement approval Council judgments are incomplete or not diverse");
    const existing = await client.query(`SELECT approval_id, candidate_id, candidate_version, candidate_content_hash, evaluation_id, evaluation_hash, council_round_id, council_evidence_ids, source_evidence_ids FROM improvement_candidate_council_approvals WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3`, [id, previous.version, previous.content_hash]);
    if (existing.rowCount === 1) { const row = existing.rows[0]!; if (row.evaluation_id !== evaluationId || row.evaluation_hash !== input.evaluationHash || row.council_round_id !== roundId) throw new ImprovementCandidatePersistenceError("Improvement approval already exists with different binding"); return { approvalId: row.approval_id, candidateId: row.candidate_id, candidateVersion: row.candidate_version, candidateContentHash: row.candidate_content_hash, evaluationId: row.evaluation_id, evaluationHash: row.evaluation_hash, councilRoundId: row.council_round_id, councilEvidenceIds: row.council_evidence_ids, sourceEvidenceIds: row.source_evidence_ids }; }
    const token = randomUUID();
    await client.query("SELECT set_config('maestro.improvement_candidate_council_approval_token', $1, true)", [token]);
    await client.query("INSERT INTO improvement_candidate_council_approval_mutation_markers (transaction_id, token_hash) VALUES (txid_current(), encode(public.digest($1, 'sha256'), 'hex'))", [token]);
    const inserted = await client.query(`INSERT INTO improvement_candidate_council_approvals (approval_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_id, evaluation_hash, council_round_id, council_evidence_ids, source_evidence_ids) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb) RETURNING approval_id, candidate_id, candidate_version, candidate_content_hash, evaluation_id, evaluation_hash, council_round_id, council_evidence_ids, source_evidence_ids`, [randomUUID(), id, previous.version, previous.content_hash, previous.project_id, previous.goal_id, evaluationId, input.evaluationHash, roundId, JSON.stringify(councilEvidenceIds), JSON.stringify(previous.source_evidence_ids)]);
    const row = inserted.rows[0]!; return { approvalId: row.approval_id, candidateId: row.candidate_id, candidateVersion: row.candidate_version, candidateContentHash: row.candidate_content_hash, evaluationId: row.evaluation_id, evaluationHash: row.evaluation_hash, councilRoundId: row.council_round_id, councilEvidenceIds: row.council_evidence_ids, sourceEvidenceIds: row.source_evidence_ids };
  });
}

/** Strict persona lifecycle transition; generic callers cannot skip its approval gate. */
export async function transitionImprovementCandidateAfterCouncil(pool: Pool, candidateId: string, proof: GoalLeaseProof, author: ImprovementCandidateAuthor, idempotencyKey: string): Promise<ImprovementCandidate> {
  authorValue(author);
  const operation = operationRef("transition", `after-council-${idempotencyKey}`);
  return withGoalAuthority(pool, proof, 94, async (client) => {
    const existing = await client.query<CandidateRow>(`SELECT ${COLUMNS} FROM improvement_candidates WHERE operation_ref = $1 FOR UPDATE`, [operation]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      const requestedId = durableUuid(candidateId, "Improvement Candidate candidateId");
      if (row.goal_id !== proof.goalId.toLowerCase() || row.kind !== "persona_axis" || row.state !== "judged" || row.parent_candidate_id?.toLowerCase() !== requestedId) {
        throw new ImprovementCandidatePersistenceError("Improvement Candidate Council transition idempotency key was reused with different candidate or Goal");
      }
      assertIdempotentReplay(row, inputFromRow(row), author, "judged", requestedId);
      const previous = await readRow(client, requestedId, true);
      if (previous.state !== "evaluated" || previous.kind !== "persona_axis") throw new ImprovementCandidatePersistenceError("Council-bound transition replay has no evaluated persona parent");
      const approval = await client.query(`SELECT 1 FROM improvement_candidate_council_approvals a JOIN improvement_candidate_evaluations e ON e.evaluation_id = a.evaluation_id AND e.candidate_id = a.candidate_id AND e.candidate_version = a.candidate_version AND e.candidate_content_hash = a.candidate_content_hash AND e.evaluation_hash = a.evaluation_hash WHERE a.candidate_id = $1 AND a.candidate_version = $2 AND a.candidate_content_hash = $3 AND a.project_id = $4 AND a.goal_id = $5`, [previous.candidate_id, previous.version, previous.content_hash, previous.project_id, previous.goal_id]);
      if (approval.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Persona candidate Council approval is missing on idempotent replay");
      return mapRow(row);
    }
    const previous = await readRow(client, candidateId, true);
    if (previous.goal_id !== proof.goalId.toLowerCase()) throw new ImprovementCandidatePersistenceError("Improvement Candidate transition is outside the lease Goal");
    if (previous.kind !== "persona_axis" || previous.state !== "evaluated") throw new ImprovementCandidatePersistenceError("Council-bound transition requires an evaluated persona candidate");
    const approval = await client.query(`SELECT 1 FROM improvement_candidate_council_approvals a JOIN improvement_candidate_evaluations e ON e.evaluation_id = a.evaluation_id AND e.candidate_id = a.candidate_id AND e.candidate_version = a.candidate_version AND e.candidate_content_hash = a.candidate_content_hash AND e.evaluation_hash = a.evaluation_hash WHERE a.candidate_id = $1 AND a.candidate_version = $2 AND a.candidate_content_hash = $3 AND a.project_id = $4 AND a.goal_id = $5`, [previous.candidate_id, previous.version, previous.content_hash, previous.project_id, previous.goal_id]);
    if (approval.rowCount !== 1) throw new ImprovementCandidatePersistenceError("Persona candidate requires durable evaluation and Council approval before judged state");
    return appendFromPrevious(client, previous, normalizeInput(inputFromRow(previous)), proof, author, operation, "judged");
  });
}


export interface ImprovementCandidateDecisionHistory {
  readonly candidate: ImprovementCandidate;
  readonly evaluation: ImprovementCandidateEvaluationRecord | null;
  readonly approval: ImprovementCandidateCouncilApproval | null;
  readonly council: Readonly<{ roundId: string; question: string; criteria: unknown; evidenceIds: readonly string[]; reviewerCount: number; finalVerdict: string; sameModelOnly: boolean; dissentNotes: readonly string[]; judgments: readonly Readonly<Record<string, unknown>>[] }> | null;
  readonly rollouts: readonly Readonly<{ rolloutId: string; status: string; activeCandidateId: string; activeVersion: number; history: readonly Readonly<Record<string, unknown>>[] }>[];
  readonly explanation: Readonly<{ changedAxes: readonly string[]; expectedBehavior: string; evidenceIds: readonly string[]; rollback: ImprovementCandidateInput["rollbackTarget"]; }>
}

/** Read-only projection used by user-facing history views; all fields come from durable records. */
export async function readImprovementCandidateDecisionHistory(pool: Pool, candidateId: string, authorization: ImprovementCandidateReadAuthorization): Promise<ImprovementCandidateDecisionHistory> {
  const candidate = await readImprovementCandidate(pool, candidateId, authorization);
  const evaluatedId = candidate.state === "evaluated" ? candidate.candidateId : (candidate.parentCandidateId ?? candidate.candidateId);
  const evaluatedVersion = candidate.state === "evaluated" ? candidate.version : Math.max(1, candidate.version - 1);
  const evaluatedHash = candidate.state === "evaluated" ? candidate.contentHash : (await pool.query<{ content_hash: string }>("SELECT content_hash FROM improvement_candidates WHERE candidate_id = $1", [evaluatedId])).rows[0]?.content_hash;
  const evaluated = await pool.query<GenericEvaluationRow>(`SELECT evaluation_id, candidate_id, candidate_version, candidate_content_hash, project_id, goal_id, evaluation_hash, evidence_ids, evaluation_payload, created_at FROM improvement_candidate_evaluations WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3 AND project_id = $4 AND goal_id = $5`, [evaluatedId, evaluatedVersion, evaluatedHash, candidate.projectId, candidate.goalId]);
  const evaluation = evaluated.rowCount === 1 ? genericEvaluationRecord(evaluated.rows[0]!) : null;
  const approvalRow = await pool.query<{ approval_id: string; candidate_id: string; candidate_version: number; candidate_content_hash: string; evaluation_id: string; evaluation_hash: string; council_round_id: string; council_evidence_ids: string[]; source_evidence_ids: string[] }>(`SELECT approval_id, candidate_id, candidate_version, candidate_content_hash, evaluation_id, evaluation_hash, council_round_id, council_evidence_ids, source_evidence_ids FROM improvement_candidate_council_approvals WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3`, [evaluatedId, evaluatedVersion, evaluation?.candidateContentHash ?? evaluatedHash ?? ""]);
  const approval = approvalRow.rowCount === 1 ? { approvalId: approvalRow.rows[0]!.approval_id, candidateId: approvalRow.rows[0]!.candidate_id, candidateVersion: approvalRow.rows[0]!.candidate_version, candidateContentHash: approvalRow.rows[0]!.candidate_content_hash, evaluationId: approvalRow.rows[0]!.evaluation_id, evaluationHash: approvalRow.rows[0]!.evaluation_hash, councilRoundId: approvalRow.rows[0]!.council_round_id, councilEvidenceIds: approvalRow.rows[0]!.council_evidence_ids, sourceEvidenceIds: approvalRow.rows[0]!.source_evidence_ids } : null;
  let council: ImprovementCandidateDecisionHistory["council"] = null;
  if (approval !== null) {
    const round = await pool.query<{ round_id: string; question: string; criteria: unknown; evidence_ids: string[]; reviewer_count: number; final_verdict: string; same_model_only: boolean; dissent_notes: string[] }>(`SELECT r.round_id, r.question, r.criteria, r.evidence_ids, r.reviewer_count, s.final_verdict, s.same_model_only, s.dissent_notes FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id WHERE r.round_id = $1`, [approval.councilRoundId]);
    const judgments = await pool.query<Record<string, unknown>>("SELECT model_provider, model_id, verdict, confidence, reasoning, conditions, dissent_note, cited_evidence_ids FROM encore_council_judgments WHERE round_id = $1 ORDER BY reviewer_index", [approval.councilRoundId]);
    if (round.rowCount === 1) { const row = round.rows[0]!; council = { roundId: row.round_id, question: row.question, criteria: row.criteria, evidenceIds: row.evidence_ids, reviewerCount: row.reviewer_count, finalVerdict: row.final_verdict, sameModelOnly: row.same_model_only, dissentNotes: row.dissent_notes, judgments: judgments.rows }; }
  }
  const rollouts = await pool.query<{ rollout_id: string; status: string; active_candidate_id: string; active_version: number }>("SELECT r.rollout_id, r.status, r.active_candidate_id, r.active_version FROM improvement_rollouts r JOIN improvement_candidates c ON c.candidate_id = r.candidate_id WHERE c.lineage_id = (SELECT lineage_id FROM improvement_candidates WHERE candidate_id = $1) ORDER BY r.created_at, r.rollout_id", [candidate.candidateId]);
  const rolloutHistory: Array<ImprovementCandidateDecisionHistory["rollouts"][number]> = [];
  for (const row of rollouts.rows) {
    const events = await pool.query<Record<string, unknown>>("SELECT event_id, kind, details, created_at FROM improvement_rollout_events WHERE rollout_id = $1 ORDER BY created_at, event_id", [row.rollout_id]);
    rolloutHistory.push({ rolloutId: row.rollout_id, status: row.status, activeCandidateId: row.active_candidate_id, activeVersion: row.active_version, history: events.rows });
  }
  return { candidate, evaluation, approval, council, rollouts: rolloutHistory, explanation: { changedAxes: candidate.changes.map((change) => change.axis), expectedBehavior: candidate.predictedEffect, evidenceIds: [...new Set([ ...candidate.sourceEvidenceIds, ...(evaluation?.evidenceIds ?? []), ...(approval?.councilEvidenceIds ?? []) ])], rollback: candidate.rollbackTarget } };
}


export interface ImprovementCandidateArrangementEvaluation {
  readonly evaluationId: string;
  readonly evaluationHash: string;
  readonly stages: Readonly<{ replay: string; shadow: string; synthetic: string }>;
  readonly metricDeltas: readonly { readonly name: string; readonly baseline: number; readonly candidate: number; readonly delta: number }[];
}
export interface ImprovementCandidateArrangementJudgment {
  readonly modelProvider: string;
  readonly modelId: string;
  readonly verdict: "proceed" | "do_not_proceed" | "escalate";
  readonly confidence: "low" | "medium" | "high";
  readonly reasoning: string;
  readonly conditions: readonly string[];
  readonly dissentNote: string | null;
  readonly citedEvidenceIds: readonly string[];
}
export interface ImprovementCandidateArrangementCouncil {
  readonly roundId: string;
  readonly question: string;
  readonly finalVerdict: "proceed" | "do_not_proceed" | "escalate";
  readonly reviewerCount: number;
  readonly sameModelOnly: boolean;
  readonly escalated: boolean;
  readonly dissentNotes: readonly string[];
  readonly judgments: readonly ImprovementCandidateArrangementJudgment[];
}
export interface ImprovementCandidateArrangementRollout {
  readonly rolloutId: string;
  readonly status: "active" | "interrupted" | "certified" | "rolled_back";
  readonly activeCandidateId: string;
  readonly activeVersion: number;
  readonly contentHash: string;
}
export interface ImprovementCandidateArrangementRecord {
  readonly candidate: ImprovementCandidate;
  readonly evaluation: ImprovementCandidateArrangementEvaluation | null;
  readonly council: ImprovementCandidateArrangementCouncil | null;
  readonly rollout: ImprovementCandidateArrangementRollout | null;
}

type ArrangementEvaluationRow = { evaluation_id: string; evaluation_hash: string; replay_payload: unknown; synthetic_payload: unknown; evaluation_payload: unknown };
type ArrangementCouncilRow = { round_id: string; question: string; reviewer_count: number; final_verdict: string; same_model_only: boolean; escalated: boolean; dissent_notes: unknown };
export interface ArrangementCouncilApprovalRow {
  readonly council_round_id: string;
  readonly candidate_id: string;
  readonly candidate_version: number;
  readonly candidate_content_hash: string;
}
/** Stable ordering for append-only approval rows returned from multiple stores. */
export function selectArrangementCouncilApproval(rows: readonly ArrangementCouncilApprovalRow[]): ArrangementCouncilApprovalRow | undefined {
  return [...rows].sort((left, right) => right.candidate_version - left.candidate_version
    || right.candidate_content_hash.localeCompare(left.candidate_content_hash)
    || left.candidate_id.localeCompare(right.candidate_id)
    || left.council_round_id.localeCompare(right.council_round_id))[0];
}
export interface ArrangementCandidateSelectionRow {
  readonly candidate_id: string;
  readonly version: number;
  readonly state: string;
}
/** Keeps latest lineage rows, rejected history, and exact active rollout targets. */
export function selectArrangementCandidateRows<T extends ArrangementCandidateSelectionRow>(
  rows: readonly T[],
  latestCandidateIds: ReadonlySet<string>,
  activeRolloutTargetKeys: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => latestCandidateIds.has(row.candidate_id)
    || row.state === "rejected"
    || activeRolloutTargetKeys.has(`${row.candidate_id}:${row.version}`));
}

interface ArrangementCouncilCandidateBinding {
  readonly candidateId: string;
  readonly version: number;
  readonly contentHash: string;
  readonly kind: ImprovementCandidate["kind"];
}
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
/** Matches only the canonical candidate identity embedded in a durable Council question. */
export function arrangementCouncilQuestionMatchesCandidate(question: string, candidate: ArrangementCouncilCandidateBinding): boolean {
  const pattern = new RegExp(String.raw`^Candidate: ${escapeRegex(candidate.candidateId)} version ${candidate.version} schemaVersion [0-9]+ contentHash ${escapeRegex(candidate.contentHash)} \(${escapeRegex(candidate.kind)}\)$`);
  return question.split("\n").some((line) => pattern.test(line));
}
type ArrangementJudgmentRow = { model_provider: string; model_id: string; verdict: string; confidence: string; reasoning: string; conditions: unknown; dissent_note: string | null; cited_evidence_ids: unknown };

function finiteMetric(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function metricDeltas(payload: unknown): readonly { readonly name: string; readonly baseline: number; readonly candidate: number; readonly delta: number }[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [];
  const replay = (payload as Record<string, unknown>).replay;
  if (replay === null || typeof replay !== "object" || Array.isArray(replay)) return [];
  const results = (replay as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];
  const totals = new Map<string, { baseline: number; candidate: number; count: number }>();
  for (const item of results) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (row.baseline === null || typeof row.baseline !== "object" || Array.isArray(row.baseline)
      || row.candidate === null || typeof row.candidate !== "object" || Array.isArray(row.candidate)) continue;
    const baseline = row.baseline as Record<string, unknown>;
    const candidate = row.candidate as Record<string, unknown>;
    for (const [name, base] of Object.entries(baseline)) {
      const next = candidate[name];
      if (!finiteMetric(base) || !finiteMetric(next)) continue;
      const prior = totals.get(name) ?? { baseline: 0, candidate: 0, count: 0 };
      prior.baseline += base; prior.candidate += next; prior.count += 1; totals.set(name, prior);
    }
  }
  return [...totals.entries()].map(([name, values]) => {
    const baseline = values.baseline / values.count; const candidate = values.candidate / values.count;
    return { name, baseline, candidate, delta: candidate - baseline };
  }).sort((left, right) => left.name.localeCompare(right.name));
}
function evaluationStages(payload: unknown): Readonly<{ replay: string; shadow: string; synthetic: string }> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return { replay: "unknown", shadow: "unknown", synthetic: "unknown" };
  const value = payload as Record<string, unknown>;
  const stage = (key: string): string => {
    const item = value[key];
    return item !== null && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).status === "string"
      ? (item as Record<string, unknown>).status as string : "unknown";
  };
  return { replay: stage("replay"), shadow: stage("shadow"), synthetic: stage("synthetic") };
}
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function arrangementJudgment(row: ArrangementJudgmentRow): ImprovementCandidateArrangementJudgment | null {
  if ((row.verdict !== "proceed" && row.verdict !== "do_not_proceed" && row.verdict !== "escalate") || (row.confidence !== "low" && row.confidence !== "medium" && row.confidence !== "high") || row.reasoning.trim() === "") return null;
  return { modelProvider: row.model_provider, modelId: row.model_id, verdict: row.verdict, confidence: row.confidence, reasoning: row.reasoning, conditions: stringArray(row.conditions), dissentNote: row.dissent_note, citedEvidenceIds: stringArray(row.cited_evidence_ids) };
}

/** Lists latest candidate versions plus every rejected version for append-only negative evidence. */
export async function listImprovementCandidateArrangements(
  pool: Pool,
  authorization: { readonly operatorId: string; readonly projectId: string },
  goalId: string,
): Promise<readonly ImprovementCandidateArrangementRecord[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertProjectMembership(client, authorization.operatorId, authorization.projectId);
    const candidateRows = await client.query<CandidateRow>(`SELECT ${COLUMNS}
      FROM improvement_candidates WHERE project_id = $1 AND goal_id = $2 ORDER BY lineage_id, version DESC, candidate_id ASC`, [authorization.projectId, goalId]);
    const activeRolloutTargets = await client.query<{ active_candidate_id: string; active_version: number }>(`SELECT DISTINCT r.active_candidate_id, r.active_version
      FROM improvement_rollouts r
      JOIN improvement_candidates target
        ON target.candidate_id = r.active_candidate_id AND target.version = r.active_version
       AND target.project_id = r.project_id AND target.goal_id = r.goal_id
      JOIN improvement_candidates source
        ON source.candidate_id = r.candidate_id AND source.lineage_id = target.lineage_id
       AND source.project_id = r.project_id AND source.goal_id = r.goal_id
      WHERE r.project_id = $1 AND r.goal_id = $2 AND r.status IN ('active', 'certified')`, [authorization.projectId, goalId]);
    const activeRolloutTargetKeys = new Set(activeRolloutTargets.rows.map((target) => `${target.active_candidate_id}:${target.active_version}`));
    const latestCandidateIds = new Set<string>();
    const latestLineages = new Set<string>();
    for (const row of candidateRows.rows) {
      if (!latestLineages.has(row.lineage_id)) {
        latestLineages.add(row.lineage_id);
        latestCandidateIds.add(row.candidate_id);
      }
    }
    const rows = selectArrangementCandidateRows(candidateRows.rows, latestCandidateIds, activeRolloutTargetKeys);
    const records: ImprovementCandidateArrangementRecord[] = [];
    for (const row of rows) {
      const candidate = mapRow(row);
      const evaluated = await client.query<{ candidate_id: string; version: number; content_hash: string }>(`SELECT candidate_id, version, content_hash FROM improvement_candidates WHERE project_id = $1 AND goal_id = $2 AND lineage_id = $3 AND version <= $4 AND state = 'evaluated' ORDER BY version DESC, candidate_id ASC LIMIT 1`, [row.project_id, row.goal_id, row.lineage_id, row.version]);
      const evaluatedRow = evaluated.rows[0];
      let evaluation: ImprovementCandidateArrangementEvaluation | null = null;
      if (evaluatedRow !== undefined) {
        let evaluationRow: ArrangementEvaluationRow | undefined;
        if (candidate.kind === "persona_axis") {
          const result = await client.query<ArrangementEvaluationRow>(`SELECT evaluation_id, evaluation_hash, NULL::jsonb AS replay_payload, NULL::jsonb AS synthetic_payload, evaluation_payload FROM improvement_candidate_evaluations WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3 AND project_id = $4 AND goal_id = $5`, [evaluatedRow.candidate_id, evaluatedRow.version, evaluatedRow.content_hash, row.project_id, row.goal_id]);
          evaluationRow = result.rows[0];
        } else {
          const result = await client.query<ArrangementEvaluationRow>(`SELECT evaluation_id, evaluation_hash, replay_payload, synthetic_payload, NULL::jsonb AS evaluation_payload FROM routing_candidate_evaluations WHERE candidate_id = $1 AND candidate_version = $2 AND candidate_content_hash = $3 AND project_id = $4 AND goal_id = $5`, [evaluatedRow.candidate_id, evaluatedRow.version, evaluatedRow.content_hash, row.project_id, row.goal_id]);
          evaluationRow = result.rows[0];
        }
        if (evaluationRow !== undefined) {
          const payload = evaluationRow.evaluation_payload ?? { replay: evaluationRow.replay_payload, synthetic: evaluationRow.synthetic_payload };
          evaluation = { evaluationId: evaluationRow.evaluation_id, evaluationHash: evaluationRow.evaluation_hash, stages: evaluationStages(payload), metricDeltas: metricDeltas(payload) };
        }
      }
      const councilBinding = evaluatedRow !== undefined && (candidate.kind === "persona_axis" || candidate.state === "rejected")
        ? evaluatedRow
        : { candidate_id: candidate.candidateId, version: candidate.version, content_hash: candidate.contentHash };
      const approvals = await client.query<ArrangementCouncilApprovalRow>(`SELECT council_round_id, candidate_id, candidate_version, candidate_content_hash
        FROM (
          SELECT a.council_round_id, a.candidate_id, a.candidate_version, a.candidate_content_hash, c.lineage_id, a.project_id, a.goal_id
            FROM improvement_candidate_council_approvals a JOIN improvement_candidates c ON c.candidate_id = a.candidate_id AND c.version = a.candidate_version AND c.content_hash = a.candidate_content_hash AND c.project_id = a.project_id AND c.goal_id = a.goal_id
          UNION ALL
          SELECT a.council_round_id, a.candidate_id, a.candidate_version, a.candidate_content_hash, c.lineage_id, a.project_id, a.goal_id
            FROM routing_candidate_approvals a JOIN improvement_candidates c ON c.candidate_id = a.candidate_id AND c.version = a.candidate_version AND c.content_hash = a.candidate_content_hash AND c.project_id = a.project_id AND c.goal_id = a.goal_id
        ) approvals
        WHERE lineage_id = $1 AND project_id = $2 AND goal_id = $3 AND candidate_id = $4 AND candidate_version = $5 AND candidate_content_hash = $6
        ORDER BY candidate_id ASC, candidate_version ASC, candidate_content_hash ASC, council_round_id ASC`, [row.lineage_id, row.project_id, row.goal_id, councilBinding.candidate_id, councilBinding.version, councilBinding.content_hash]);
      let council: ImprovementCandidateArrangementCouncil | null = null;
      let roundId = candidate.state === "rejected" ? undefined : selectArrangementCouncilApproval(approvals.rows)?.council_round_id;
      if (roundId === undefined) {
        const rounds = await client.query<{ round_id: string; question: string; final_verdict: "proceed" | "do_not_proceed" | "escalate" }>(`SELECT r.round_id, r.question, s.final_verdict
          FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id JOIN goals g ON g.goal_id = r.goal_id
          WHERE r.goal_id = $1 AND g.project_id = $2
          ORDER BY r.created_at DESC, r.round_id ASC`, [row.goal_id, row.project_id]);
        const matchedRound = rounds.rows.find((round) => arrangementCouncilQuestionMatchesCandidate(round.question, {
          candidateId: councilBinding.candidate_id,
          version: councilBinding.version,
          contentHash: councilBinding.content_hash,
          kind: candidate.kind,
        }) && (candidate.state !== "rejected" || round.final_verdict !== "proceed"));
        roundId = matchedRound?.round_id;
      }
      if (roundId !== undefined) {
        const round = await client.query<ArrangementCouncilRow>(`SELECT r.round_id, r.question, r.reviewer_count, s.final_verdict, s.same_model_only, s.escalated, s.dissent_notes FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id JOIN goals g ON g.goal_id = r.goal_id WHERE r.round_id = $1 AND r.goal_id = $2 AND g.project_id = $3`, [roundId, row.goal_id, row.project_id]);
        const judgmentRows = await client.query<ArrangementJudgmentRow>("SELECT j.model_provider, j.model_id, j.verdict, j.confidence, j.reasoning, j.conditions, j.dissent_note, j.cited_evidence_ids FROM encore_council_judgments j JOIN encore_council_rounds r ON r.round_id = j.round_id JOIN goals g ON g.goal_id = r.goal_id WHERE j.round_id = $1 AND r.goal_id = $2 AND g.project_id = $3 ORDER BY j.reviewer_index", [roundId, row.goal_id, row.project_id]);
        const roundRow = round.rows[0];
        const judgments = judgmentRows.rows.flatMap((item) => { const mapped = arrangementJudgment(item); return mapped === null ? [] : [mapped]; });
        if (roundRow !== undefined && (roundRow.final_verdict === "proceed" || roundRow.final_verdict === "do_not_proceed" || roundRow.final_verdict === "escalate")) {
          council = { roundId: roundRow.round_id, question: roundRow.question, reviewerCount: roundRow.reviewer_count, finalVerdict: roundRow.final_verdict, sameModelOnly: roundRow.same_model_only, escalated: roundRow.escalated, dissentNotes: stringArray(roundRow.dissent_notes), judgments };
        }
      }
      const rollout = await client.query<{ rollout_id: string; status: ImprovementCandidateArrangementRollout["status"]; active_candidate_id: string; active_version: number; content_hash: string }>(`SELECT r.rollout_id, r.status, r.active_candidate_id, r.active_version, c.content_hash
        FROM improvement_rollouts r
        JOIN improvement_candidates source ON source.candidate_id = r.candidate_id AND source.version = r.candidate_version AND source.project_id = r.project_id AND source.goal_id = r.goal_id
        JOIN improvement_candidates c ON c.candidate_id = r.active_candidate_id AND c.version = r.active_version AND c.project_id = r.project_id AND c.goal_id = r.goal_id
        WHERE r.project_id = $1 AND r.goal_id = $2 AND r.active_candidate_id = $3 AND r.active_version = $4 AND c.candidate_id = $3 AND c.content_hash = $5
        ORDER BY r.created_at DESC, r.rollout_id DESC LIMIT 1`, [row.project_id, row.goal_id, row.candidate_id, row.version, row.content_hash]);
      const rolloutRow = rollout.rows[0];
      records.push({ candidate, evaluation, council, rollout: rolloutRow === undefined ? null : { rolloutId: rolloutRow.rollout_id, status: rolloutRow.status, activeCandidateId: rolloutRow.active_candidate_id, activeVersion: rolloutRow.active_version, contentHash: rolloutRow.content_hash } });
    }
    await client.query("COMMIT");
    return records;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
