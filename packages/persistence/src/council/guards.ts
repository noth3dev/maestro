import {
  TASK_CONTRACT_SCHEMA_VERSION,
  assertValidTaskContractSubstance,
  canonicalJson,
  hydrateSealedSubmissionSnapshot,
  taskContractContentHash,
  type CouncilRoundContribution,
  type SealedSubmissionSnapshot,
  type TaskContractSubstance,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "../commands.js";
import { assertGoalControlOpen } from "./control.js";
import {
  CouncilProtocolError,
  isAuthorizedHeadCouncilActor,
  type CouncilActorContext,
  type CouncilProtocolEventType,
  type CouncilTaskContractRow,
  type HeadCouncil,
  type HeadCouncilState,
  type StoredCreationEventRow,
} from "./types.js";

export function validProofFor(goalId: string, proof: GoalLeaseProof): boolean { return goalId === proof.goalId && proof.goalId !== "" && proof.ownerId !== "" && isValidFencingToken(proof.fencingToken); }

export function requireState(council: HeadCouncil, state: HeadCouncilState): void { if (council.state !== state) throw new CouncilProtocolError(`Council is ${council.state}, not ${state}`); }

export async function lockGoal(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

export function assertLaunchedTaskContract(row: CouncilTaskContractRow, contractId: string): TaskContractSubstance {
  if (row.launch_state !== "launched") throw new CouncilProtocolError(`Task Contract must be launched before Head Council creation: ${contractId}`);
  if (row.schema_version !== TASK_CONTRACT_SCHEMA_VERSION) throw new CouncilProtocolError(`Task Contract schema version is unsupported: ${contractId}`);
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new CouncilProtocolError(`Task Contract version is invalid: ${contractId}`);
  try {
    assertValidTaskContractSubstance(row.content);
  } catch (error) {
    throw new CouncilProtocolError(`Task Contract substance is invalid: ${error instanceof Error ? error.message : contractId}`);
  }
  const contentHash = row.content_hash.trim();
  if (!/^[0-9a-f]{64}$/.test(contentHash) || taskContractContentHash(row.content) !== contentHash) {
    throw new CouncilProtocolError(`Task Contract content hash mismatch: ${contractId}`);
  }
  return row.content;
}

export async function assertAuthorizedBriefActor(client: PoolClient, council: HeadCouncil, departmentId: string, context: CouncilActorContext): Promise<void> {
  await assertAuthorizedCapturedActor(client, council, departmentId, context);
}

/** Every per-Department Council action (brief, round contribution) must come from the captured, currently active Head, never merely from Goal lease possession. */
export async function assertAuthorizedCapturedActor(client: PoolClient, council: HeadCouncil, departmentId: string, context: CouncilActorContext): Promise<void> {
  const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
  if (captured === undefined) throw new CouncilProtocolError("Council actor is not bound to the captured Head identity and session");
  // New snapshots bind actor identity to the durable HeadRoleId. Legacy
  // snapshots retain department participantId and continue using that identity
  // until their protocol naturally expires.
  const authorized = captured.headRoleId !== undefined
    ? isAuthorizedHeadCouncilActor(context, captured)
    : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
  if (!authorized) throw new CouncilProtocolError("Council actor is not bound to the captured Head identity and session");
  const roleClause = captured.headRoleId === undefined ? "" : " AND head_role_id = $5";
  const values = captured.headRoleId === undefined
    ? [council.goalId, departmentId, council.contractId, captured.sessionRef]
    : [council.goalId, departmentId, council.contractId, captured.sessionRef, captured.headRoleId];
  const active = await client.query(
    `SELECT 1 FROM goal_head_participations
      WHERE goal_id = $1 AND department_id = $2 AND contract_id = $3
        AND status = 'active' AND active_session_ref = $4${roleClause}
      FOR UPDATE`,
    values,
  );
  if (active.rowCount !== 1) throw new CouncilProtocolError("Captured Head session is no longer authorized");
}

export function extractEvidenceReferences(value: Readonly<Record<string, unknown>>): readonly string[] {
  const references = new Set<string>();
  collectPayloadEvidenceReferences(value, references);
  return [...references];
}

export function collectPayloadEvidenceReferences(value: unknown, references: Set<string>, keyHint?: string): void {
  if (typeof value === "string") {
    if (keyHint !== undefined && ["reference", "references", "evidenceReference", "evidenceReferences", "evidenceId", "evidenceIds", "id", "newEvidence"].includes(keyHint)) {
      if (value.trim() !== "") references.add(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collectPayloadEvidenceReferences(item, references, keyHint); return; }
  if (value !== null && typeof value === "object") for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) collectPayloadEvidenceReferences(candidate, references, key);
}

export async function loadDurableEvidenceReferences(queryable: Pick<Pool | PoolClient, "query">, goalId: string, projectId: string): Promise<Set<string>> {
  const recorded = await queryable.query<{ evidence_id: string; sha256: string }>(
    "SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2",
    [goalId, projectId],
  );
  const references = new Set<string>();
  for (const row of recorded.rows) {
    references.add(row.evidence_id.trim());
    references.add(row.sha256.trim());
  }
  return references;
}

export async function assertDurableEvidenceReferences(
  queryable: Pick<Pool | PoolClient, "query">,
  goalId: string,
  projectId: string,
  value: Readonly<Record<string, unknown>>,
  label: string,
): Promise<Set<string>> {
  const durable = await loadDurableEvidenceReferences(queryable, goalId, projectId);
  for (const reference of extractEvidenceReferences(value)) {
    if (!durable.has(reference.trim())) throw new CouncilProtocolError(`${label} reference is not a durable goal-scoped evidence record: ${reference}`);
  }
  return durable;
}

export async function assertCouncilCreationAnchor(queryable: Pick<Pool | PoolClient, "query">, council: HeadCouncil): Promise<void> {
  const result = await queryable.query<StoredCreationEventRow>(
    `SELECT goal_id, snapshot_hash, payload
       FROM council_protocol_events
      WHERE council_id = $1 AND event_type = 'council_created'`,
    [council.councilId],
  );
  if (result.rowCount !== 1) throw new CouncilProtocolError("Council creation snapshot anchor is missing or duplicated");
  const anchor = result.rows[0]!;
  if (anchor.goal_id !== council.goalId || anchor.snapshot_hash.trim() !== council.snapshotHash) {
    throw new CouncilProtocolError("Council creation snapshot anchor does not match the Council projection");
  }
  const snapshotValue = anchor.payload?.snapshot;
  let anchoredSnapshot: SealedSubmissionSnapshot;
  try {
    anchoredSnapshot = hydrateSealedSubmissionSnapshot(snapshotValue, anchor.snapshot_hash.trim());
  } catch (error) {
    throw new CouncilProtocolError(`Council creation snapshot anchor is invalid: ${error instanceof Error ? error.message : "invalid snapshot"}`);
  }
  if (canonicalJson(anchoredSnapshot) !== canonicalJson(council.snapshot)) {
    throw new CouncilProtocolError("Council creation snapshot anchor does not match the immutable snapshot");
  }
}

/** A resolved/escalated decision projection must be backed by exactly one matching append-only decision event, never a bare mutable field. */
export async function assertDecisionAnchor(queryable: Pick<Pool | PoolClient, "query">, council: HeadCouncil): Promise<void> {
  if (council.decisionPacket === null) return;
  const expectedEventType = council.state === "escalated" ? "decision_escalated" : "decision_resolved";
  const result = await queryable.query<{ event_type: CouncilProtocolEventType; goal_id: string; snapshot_hash: string; payload: Record<string, unknown> }>(
    `SELECT event_type, goal_id, snapshot_hash, payload
       FROM council_protocol_events
      WHERE council_id = $1 AND event_type IN ('decision_resolved', 'decision_escalated')`,
    [council.councilId],
  );
  if (result.rowCount !== 1) throw new CouncilProtocolError("Council decision anchor event is missing or duplicated");
  const anchor = result.rows[0]!;
  if (anchor.event_type !== expectedEventType || anchor.goal_id !== council.goalId || anchor.snapshot_hash.trim() !== council.snapshotHash) {
    throw new CouncilProtocolError("Council decision anchor event does not match the Council projection");
  }
  if (canonicalJson(anchor.payload?.packet) !== canonicalJson(council.decisionPacket)) {
    throw new CouncilProtocolError("Council decision anchor event does not match the immutable decision packet");
  }
}

export async function assertParticipantSnapshot(queryable: Pick<Pool | PoolClient, "query">, council: HeadCouncil): Promise<void> {
  const rows = await queryable.query<{ department_id: string; head_role_id: string; session_ref: string }>(
    "SELECT department_id, head_role_id, session_ref FROM council_participants WHERE council_id = $1 ORDER BY department_id, head_role_id",
    [council.councilId],
  );
  const expected = council.snapshot.participants;
  if (rows.rowCount !== expected.length || rows.rows.some((row, index) => {
    const participant = expected[index];
    return participant === undefined
      || row.department_id !== (participant.departmentId ?? participant.participantId)
      || (participant.headRoleId !== undefined && row.head_role_id !== participant.headRoleId)
      || row.session_ref !== participant.sessionRef;
  })) {
    throw new CouncilProtocolError("Council participants no longer match the frozen snapshot");
  }
}

export async function settlementCounts(client: PoolClient, councilId: string): Promise<{ participants: number; briefs: number; absent: number }> { const result = await client.query<{ participants: number; briefs: number; absent: number }>(`SELECT (SELECT count(*)::int FROM council_participants WHERE council_id = $1) participants, (SELECT count(*)::int FROM independent_briefs WHERE council_id = $1) briefs, (SELECT count(*)::int FROM council_participants WHERE council_id = $1 AND absent_at IS NOT NULL) absent`, [councilId]); return result.rows[0]!; }

export async function knownEvidenceReferences(client: PoolClient, council: HeadCouncil, prior: readonly CouncilRoundContribution[]): Promise<Set<string>> {
  const durable = await assertDurableEvidenceReferences(client, council.goalId, council.snapshot.projectId, council.snapshot.evidence, "Frozen Council evidence");
  for (const contribution of prior) {
    for (const reference of contribution.newEvidence) {
      if (!durable.has(reference.trim())) throw new CouncilProtocolError(`Recorded Council round evidence is not durable: ${reference}`);
    }
  }
  return durable;
}
