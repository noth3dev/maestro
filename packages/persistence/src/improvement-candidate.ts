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

function operationRef(kind: "record" | "append" | "transition", idempotencyKey: string): string {
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
    if (!canTransitionImprovementCandidate(previous.state, nextState)) throw new ImprovementCandidatePersistenceError(`Improvement Candidate cannot transition from ${previous.state} to ${nextState}`);
    return appendFromPrevious(client, previous, normalizeInput(inputFromRow(previous)), proof, author, operation, nextState);
  });
}
