import { createHash, randomUUID } from "node:crypto";
import {
  assertValidCouncilRoundContribution,
  assertValidDecisionPacket,
  assertValidIndependentBrief,
  assertValidTaskContractSubstance,
  canonicalJson,
  freezeSealedSubmissionSnapshot,
  hydrateSealedSubmissionSnapshot,
  isMaterialCouncilRound,
  taskContractContentHash,
  TASK_CONTRACT_SCHEMA_VERSION,
  type CouncilRoundContribution,
  type DecisionPacket,
  type TaskContractSubstance,
  type IndependentBrief,
  type SealedSubmissionParticipant,
  type SealedSubmissionSnapshot,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";

export type HeadCouncilState = "collecting" | "revealed" | "resolved" | "escalated" | "stopped_no_new_evidence";
export type CouncilProtocolEventType = "council_created" | "brief_submitted" | "participant_absent" | "briefs_revealed" | "round_recorded" | "council_stopped" | "decision_resolved" | "decision_escalated";

export interface HeadCouncil {
  readonly councilId: string;
  readonly goalId: string;
  readonly contractId: string;
  /** Canonical UTC timestamp; no mutable Date crosses the snapshot boundary. */
  readonly briefDeadline: string;
  readonly state: HeadCouncilState;
  readonly noNewEvidenceStreak: number;
  readonly decisionPacket: DecisionPacket | null;
  readonly snapshotHash: string;
  readonly snapshot: HeadCouncilSnapshot;
}

export interface CouncilActorContext {
  readonly actorId: string;
  readonly sessionRef: string;
  readonly commandId?: string;
  readonly idempotencyKey?: string;
}

/** New Council snapshots carry both durable Head identity and Department context. */
export interface HeadCouncilParticipant extends SealedSubmissionParticipant {
  /** Optional only for snapshots created before HeadRoleId hardening. */
  readonly headRoleId?: string;
  /** Optional only for snapshots created before HeadRoleId hardening. */
  readonly departmentId?: string;
}

export type HeadCouncilSnapshot = Omit<SealedSubmissionSnapshot, "participants"> & {
  readonly participants: readonly HeadCouncilParticipant[];
};

export function toHeadCouncilParticipant(identity: {
  readonly headRoleId: string;
  readonly departmentId: string;
  readonly sessionRef: string;
}): HeadCouncilParticipant {
  if (identity.headRoleId.trim() === "") throw new CouncilProtocolError("HeadRoleId is required");
  if (identity.departmentId.trim() === "") throw new CouncilProtocolError("Department identity is required");
  if (identity.sessionRef.trim() === "") throw new CouncilProtocolError("Head session identity is required");
  return {
    participantId: identity.headRoleId,
    headRoleId: identity.headRoleId,
    departmentId: identity.departmentId,
    sessionRef: identity.sessionRef,
  };
}

export function isAuthorizedHeadCouncilActor(
  context: Pick<CouncilActorContext, "actorId" | "sessionRef">,
  participant: Pick<HeadCouncilParticipant, "headRoleId" | "sessionRef">,
): boolean {
  return participant.headRoleId !== undefined
    && context.actorId === participant.headRoleId
    && context.sessionRef === participant.sessionRef;
}

export interface CreateHeadCouncilRequest {
  readonly councilId?: string;
  readonly goalId: string;
  readonly contractId: string;
  readonly briefDeadline: Date | string;
  readonly evidence: Readonly<Record<string, unknown>>;
  /** Request metadata is supported for callers that keep creation identity in one object. */
  readonly actorId?: string;
  readonly sessionRef?: string;
  readonly commandId?: string;
  readonly idempotencyKey?: string;
}

export interface RoundInput {
  readonly departmentId: string;
  readonly contribution: CouncilRoundContribution;
  /** Each round contribution is authorized to the captured Head, not fabricated by whoever holds the Goal lease. */
  readonly submittedBy: CouncilActorContext;
}

export interface CouncilProtocolEvent {
  readonly eventSequence: string;
  readonly eventId: string;
  readonly councilId: string;
  readonly goalId: string;
  readonly eventType: CouncilProtocolEventType;
  readonly actorId: string;
  readonly sessionRef: string;
  readonly commandId: string | null;
  readonly idempotencyKey: string | null;
  readonly commandOrIdempotencyId: string;
  readonly snapshotHash: string;
  readonly evidenceLineage: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export class HeadCouncilNotFoundError extends Error {}
export class CouncilProtocolError extends Error {}
export class CouncilBriefsSealedError extends Error {}
export class CouncilBriefIdempotencyError extends CouncilProtocolError {}

interface CouncilRow {
  council_id: string;
  goal_id: string;
  contract_id: string;
  brief_deadline: Date | string;
  state: HeadCouncilState;
  no_new_evidence_streak: number;
  decision_packet: DecisionPacket | null;
  snapshot_hash: string;
  snapshot_payload: unknown;
}

interface CouncilTaskContractRow {
  schema_version: number;
  version: string;
  content: unknown;
  content_hash: string;
  launch_state: string;
}

interface StoredBriefRow {
  department_id: string;
  payload: IndependentBrief;
  payload_hash: string;
  idempotency_key: string;
  submitted_at: Date;
}

interface StoredEventRow {
  event_sequence: string;
  event_id: string;
  council_id: string;
  goal_id: string;
  event_type: CouncilProtocolEventType;
  actor_id: string;
  session_ref: string;
  command_id: string | null;
  idempotency_key: string | null;
  command_or_idempotency_id: string;
  snapshot_hash: string;
  evidence_lineage: Record<string, unknown>;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

export async function createHeadCouncil(pool: Pool, request: CreateHeadCouncilRequest, proof: GoalLeaseProof, context?: CouncilActorContext): Promise<HeadCouncil> {
  if (!validProofFor(request.goalId, proof) || request.contractId.trim() === "") throw new StaleGoalLeaseError(request.goalId);
  const actorContext = resolveContext(proof, context ?? requestContext(request, proof), `council:create:${request.councilId ?? "new"}`);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true; await lockGoal(client, proof);
    const goalRow = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1 FOR KEY SHARE", [request.goalId]);
    if (goalRow.rowCount !== 1) throw new CouncilProtocolError("Goal not found for Head Council creation");
    const contractRow = await client.query<CouncilTaskContractRow>("SELECT schema_version, version, content, content_hash, launch_state FROM task_contracts WHERE contract_id = $1 FOR UPDATE", [request.contractId]);
    if (contractRow.rowCount !== 1) throw new CouncilProtocolError("Task Contract not found for Head Council creation");
    const contract = contractRow.rows[0]!;
    const contractContent = assertLaunchedTaskContract(contract, request.contractId);
    const contractProjectId = (contractContent as unknown as { project?: { projectId?: unknown } }).project?.projectId;
    if (typeof contractProjectId !== "string" || contractProjectId.trim() !== goalRow.rows[0]!.project_id) {
      throw new CouncilProtocolError("Task Contract project identity does not match the Goal's project");
    }
    await assertDurableEvidenceReferences(client, request.goalId, goalRow.rows[0]!.project_id, request.evidence, "Frozen Council evidence");
    const participants = await client.query<{ department_id: string; head_role_id: string; active_session_ref: string }>(
      `SELECT department_id, head_role_id, active_session_ref
       FROM goal_head_participations
       WHERE goal_id = $1 AND contract_id = $2 AND status = 'active'
       ORDER BY department_id, head_role_id FOR UPDATE`,
      [request.goalId, request.contractId],
    );
    if (participants.rowCount === 0) throw new CouncilProtocolError("A Head Council requires active Heads bound to the selected contract");
    const snapshot = freezeSealedSubmissionSnapshot({
      projectId: goalRow.rows[0]!.project_id,
      goalId: request.goalId,
      contract: { contractId: request.contractId, version: Number(contract.version), contentHash: contract.content_hash.trim(), content: contractContent as unknown as Readonly<Record<string, unknown>> },
      participants: participants.rows.map((row) => toHeadCouncilParticipant({
        headRoleId: row.head_role_id,
        departmentId: row.department_id,
        sessionRef: row.active_session_ref,
      })),
      evidence: request.evidence,
      deadline: request.briefDeadline,
    });
    const deadlineCheck = await client.query<{ inFuture: boolean }>("SELECT clock_timestamp() < $1::timestamptz AS \"inFuture\"", [snapshot.deadline]);
    if (deadlineCheck.rowCount !== 1 || !deadlineCheck.rows[0]!.inFuture) throw new CouncilProtocolError("Head Council brief deadline must be in the future");
    const existingByIdentity = await client.query<CouncilRow>(`SELECT council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash, snapshot_payload FROM head_councils WHERE goal_id = $1 AND contract_id = $2`, [request.goalId, request.contractId]);
    if ((existingByIdentity.rowCount ?? 0) > 0) {
      const prior = existingByIdentity.rows[0]!;
      if (prior.snapshot_hash.trim() === snapshot.snapshotHash) { await client.query("COMMIT"); open = false; return mapCouncil(prior); }
      throw new CouncilProtocolError("A Head Council already exists for this Goal and Task Contract");
    }
    const councilId = request.councilId ?? randomUUID();
    const inserted = await client.query<CouncilRow>(`INSERT INTO head_councils (council_id, goal_id, contract_id, brief_deadline, state, snapshot_hash, snapshot_payload) VALUES ($1, $2, $3, $4, 'collecting', $5, $6::jsonb) RETURNING council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash, snapshot_payload`, [councilId, request.goalId, request.contractId, snapshot.deadline, snapshot.snapshotHash, JSON.stringify(snapshot)]);
    for (const participant of participants.rows) {
      await client.query(
        "INSERT INTO council_participants (council_id, department_id, head_role_id, session_ref) VALUES ($1, $2, $3, $4)",
        [councilId, participant.department_id, participant.head_role_id, participant.active_session_ref],
      );
    }
    const council = mapCouncil(inserted.rows[0]!);
    await insertProtocolEvent(client, council, "council_created", actorContext, { snapshot: council.snapshot }, actorContext.commandId ?? actorContext.idempotencyKey ?? `council:create:${council.councilId}`);
    await client.query("COMMIT"); open = false; return council;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Read path verifies the complete persisted snapshot and its hash on every load. */
export async function readHeadCouncil(pool: Pool, councilId: string): Promise<HeadCouncil> {
  const result = await pool.query<CouncilRow>(councilSelectSql() + " WHERE council_id = $1", [councilId]);
  if (result.rowCount !== 1) throw new HeadCouncilNotFoundError(`Council not found: ${councilId}`);
  const council = mapCouncil(result.rows[0]!);
  await assertParticipantSnapshot(pool, council);
  await assertCouncilCreationAnchor(pool, council);
  await assertDecisionAnchor(pool, council);
  await assertDurableEvidenceReferences(pool, council.goalId, council.snapshot.projectId, council.snapshot.evidence, "Frozen Council evidence");
  return council;
}
/** Alias for callers that use the persistence layer's get/read naming convention. */
export const getHeadCouncil = readHeadCouncil;

export async function submitIndependentBrief(pool: Pool, councilId: string, departmentId: string, brief: IndependentBrief, proof: GoalLeaseProof, context?: CouncilActorContext): Promise<void> {
  assertValidIndependentBrief(brief);
  const payloadHash = briefPayloadHash(brief);
  await mutateCouncil(pool, councilId, proof, context, `brief:${departmentId}:${payloadHash}`, async (client, council, actorContext) => {
    await assertAuthorizedBriefActor(client, council, departmentId, actorContext);
    const idempotencyKey = actorContext.idempotencyKey ?? `brief:${departmentId}:${payloadHash}`;
    const existing = await client.query<StoredBriefRow>(`SELECT department_id, payload, payload_hash, idempotency_key, submitted_at FROM independent_briefs WHERE council_id = $1 AND (department_id = $2 OR idempotency_key = $3) FOR KEY SHARE`, [councilId, departmentId, idempotencyKey]);
    if ((existing.rowCount ?? 0) > 0) {
      const priorForDepartment = existing.rows.find((row) => row.department_id === departmentId);
      const priorForKey = existing.rows.find((row) => row.idempotency_key === idempotencyKey);
      if (priorForKey !== undefined && priorForKey.department_id !== departmentId) throw new CouncilBriefIdempotencyError("Independent brief idempotency identity was reused by another participant");
      const prior = priorForDepartment ?? priorForKey;
      if (prior === undefined || prior.payload_hash !== payloadHash || canonicalJson(prior.payload) !== canonicalJson(brief)) throw new CouncilBriefIdempotencyError("Independent brief idempotency identity was reused with different content");
      return;
    }
    requireState(council, "collecting");
    const participant = await client.query<{ session_ref: string }>("SELECT session_ref FROM council_participants WHERE council_id = $1 AND department_id = $2 AND absent_at IS NULL FOR KEY SHARE", [councilId, departmentId]);
    if (participant.rowCount !== 1) throw new CouncilProtocolError("Only a present captured Council participant may submit a brief");
    const deadline = await client.query<{ accepting: boolean }>("SELECT clock_timestamp() < brief_deadline AS accepting FROM head_councils WHERE council_id = $1", [councilId]);
    if (deadline.rowCount !== 1 || !deadline.rows[0]!.accepting) throw new CouncilProtocolError("Brief deadline has passed");
    await client.query("INSERT INTO independent_briefs (council_id, department_id, payload, payload_hash, idempotency_key) VALUES ($1, $2, $3::jsonb, $4, $5)", [councilId, departmentId, JSON.stringify(brief), payloadHash, idempotencyKey]);
    await insertProtocolEvent(client, council, "brief_submitted", actorContext, { departmentId, payloadHash, brief }, idempotencyKey);
  });
}

/** Missing Heads become absent only after the deadline, with an auditable nonblank reason. */
export async function markMissingCouncilParticipantsAbsent(pool: Pool, councilId: string, reasons: Readonly<Record<string, string>>, proof: GoalLeaseProof, context?: CouncilActorContext): Promise<void> {
  await mutateCouncil(pool, councilId, proof, context, `absence:${councilId}`, async (client, council, actorContext) => {
    requireState(council, "collecting");
    // Lock every participant before taking the deadline decision. A current
    // clock reading after these locks prevents a wait from crossing the
    // deadline while still using an earlier timestamp.
    const missing = await client.query<{ department_id: string; session_ref: string }>(`SELECT p.department_id, p.session_ref FROM council_participants p LEFT JOIN independent_briefs b ON b.council_id = p.council_id AND b.department_id = p.department_id WHERE p.council_id = $1 AND p.absent_at IS NULL AND b.department_id IS NULL FOR UPDATE OF p`, [councilId]);
    const deadline = await client.query<{ elapsed: boolean }>("SELECT clock_timestamp() >= $1::timestamptz AS elapsed", [council.briefDeadline]);
    if (deadline.rowCount !== 1 || !deadline.rows[0]!.elapsed) throw new CouncilProtocolError("Brief deadline has not passed");
    for (const row of missing.rows) {
      const reason = reasons[row.department_id];
      if (typeof reason !== "string" || reason.trim() === "") throw new CouncilProtocolError(`Missing absence reason for ${row.department_id}`);
    }
    if (Object.keys(reasons).some((departmentId) => !missing.rows.some((row) => row.department_id === departmentId))) throw new CouncilProtocolError("Absence reasons may name only missing participants");
    for (const row of missing.rows) {
      const reason = reasons[row.department_id]!.trim();
      await client.query("UPDATE council_participants SET absence_reason = $3, absent_at = clock_timestamp() WHERE council_id = $1 AND department_id = $2", [councilId, row.department_id, reason]);
      await insertProtocolEvent(client, council, "participant_absent", actorContext, { departmentId: row.department_id, reason }, `absence:${councilId}:${row.department_id}` , row.session_ref);
    }
  });
}

export async function revealCouncilBriefs(pool: Pool, councilId: string, proof: GoalLeaseProof, context?: CouncilActorContext): Promise<void> {
  await mutateCouncil(pool, councilId, proof, context, `reveal:${councilId}`, async (client, council, actorContext) => {
    requireState(council, "collecting");
    const counts = await settlementCounts(client, councilId);
    const allSubmitted = counts.briefs === counts.participants && counts.absent === 0;
    const deadline = await client.query<{ elapsed: boolean }>("SELECT clock_timestamp() >= $1::timestamptz AS elapsed", [council.briefDeadline]);
    const deadlineSettled = deadline.rowCount === 1 && deadline.rows[0]!.elapsed && counts.briefs + counts.absent === counts.participants;
    if (!allSubmitted && !deadlineSettled) throw new CouncilProtocolError("Briefs remain sealed until all submit or every deadline-missing participant is marked absent");
    await client.query("UPDATE head_councils SET state = 'revealed', revealed_at = clock_timestamp() WHERE council_id = $1", [councilId]);
    await insertProtocolEvent(client, council, "briefs_revealed", actorContext, { briefs: counts.briefs, absent: counts.absent }, `reveal:${councilId}`);
  });
}

export async function readRevealedCouncilBriefs(pool: Pool, councilId: string): Promise<readonly { departmentId: string; brief: IndependentBrief; submittedAt: string }[]> {
  const council = await readHeadCouncil(pool, councilId);
  if (council.state === "collecting") throw new CouncilBriefsSealedError("Independent briefs are sealed before reveal");
  const rows = await pool.query<{ department_id: string; payload: IndependentBrief; payload_hash: string; submitted_at: Date }>("SELECT department_id, payload, payload_hash, submitted_at FROM independent_briefs WHERE council_id = $1 ORDER BY submitted_at, department_id", [councilId]);
  return rows.rows.map((row) => {
    if (briefPayloadHash(row.payload) !== row.payload_hash.trim()) throw new CouncilProtocolError(`Revealed brief content does not match its recorded hash: ${row.department_id}`);
    return { departmentId: row.department_id, brief: row.payload, submittedAt: row.submitted_at.toISOString() };
  });
}

/** Adds one protocol round. All present participants must contribute exactly once. */
export async function recordCouncilRound(pool: Pool, councilId: string, contributions: readonly RoundInput[], proof: GoalLeaseProof, context?: CouncilActorContext): Promise<HeadCouncil> {
  const seen = new Set<string>();
  for (const entry of contributions) { if (seen.has(entry.departmentId)) throw new CouncilProtocolError("A participant may contribute once per round"); seen.add(entry.departmentId); assertValidCouncilRoundContribution(entry.contribution); }
  return mutateCouncil(pool, councilId, proof, context, `round:${councilId}`, async (client, council, actorContext) => {
    requireState(council, "revealed");
    for (const entry of contributions) await assertAuthorizedCapturedActor(client, council, entry.departmentId, entry.submittedBy);
    const present = await client.query<{ department_id: string }>("SELECT department_id FROM council_participants WHERE council_id = $1 AND absent_at IS NULL ORDER BY department_id FOR KEY SHARE", [councilId]);
    const expected = present.rows.map((row) => row.department_id);
    const actual = [...seen].sort();
    if (expected.length === 0 || expected.length !== actual.length || expected.some((departmentId, index) => departmentId !== actual[index])) throw new CouncilProtocolError("A Council round must contain exactly one contribution from every present participant");
    const priorRows = await client.query<{ payload: CouncilRoundContribution }>(`SELECT c.payload FROM council_round_contributions c JOIN council_rounds r ON r.round_id = c.round_id WHERE r.council_id = $1 ORDER BY r.round_number, c.department_id`, [councilId]);
    const prior = priorRows.rows.map((row) => row.payload);
    const allowedEvidence = await knownEvidenceReferences(client, council, prior);
    for (const entry of contributions) for (const tag of entry.contribution.newEvidence) if (!allowedEvidence.has(tag.trim())) throw new CouncilProtocolError(`Council round evidence tag is not a frozen or recorded reference: ${tag}`);
    const material = contributions.some((entry) => isMaterialCouncilRound(entry.contribution, prior));
    const previous = await client.query<{ round_number: number }>("SELECT round_number FROM council_rounds WHERE council_id = $1 ORDER BY round_number DESC LIMIT 1 FOR UPDATE", [councilId]);
    const roundId = randomUUID(); const number = (previous.rows[0]?.round_number ?? 0) + 1;
    await client.query("INSERT INTO council_rounds (round_id, council_id, round_number, has_material_contribution) VALUES ($1, $2, $3, $4)", [roundId, councilId, number, material]);
    for (const entry of contributions) await client.query("INSERT INTO council_round_contributions (contribution_id, round_id, department_id, payload) VALUES ($1, $2, $3, $4::jsonb)", [randomUUID(), roundId, entry.departmentId, JSON.stringify(entry.contribution)]);
    const streak = material ? 0 : council.noNewEvidenceStreak + 1;
    const stopped = streak >= 2;
    const updated = await client.query<CouncilRow>(`UPDATE head_councils SET no_new_evidence_streak = $2, state = CASE WHEN $3 THEN 'stopped_no_new_evidence' ELSE state END, closed_at = CASE WHEN $3 THEN transaction_timestamp() ELSE closed_at END WHERE council_id = $1 RETURNING council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash, snapshot_payload`, [councilId, streak, stopped]);
    const next = mapCouncil(updated.rows[0]!);
    await insertProtocolEvent(client, council, "round_recorded", actorContext, { roundId, roundNumber: number, material, contributions }, `round:${councilId}:${number}`);
    if (stopped) await insertProtocolEvent(client, next, "council_stopped", actorContext, { reason: "two consecutive rounds added no new evidence or argument", roundNumber: number }, `stop:${councilId}:${number}`);
    return next;
  });
}

export async function recordCouncilDecisionPacket(pool: Pool, councilId: string, packet: DecisionPacket, proof: GoalLeaseProof, context?: CouncilActorContext): Promise<HeadCouncil> {
  assertValidDecisionPacket(packet);
  return mutateCouncil(pool, councilId, proof, context, `decision:${councilId}`, async (client, council, actorContext) => {
    if (council.decisionPacket !== null) {
      // Idempotent retry: identical content is a no-op; different content is a conflict, never a silent overwrite.
      if (canonicalJson(council.decisionPacket) === canonicalJson(packet)) return council;
      throw new CouncilProtocolError("Council decision packet is immutable once resolved or escalated");
    }
    if (council.state !== "revealed" && council.state !== "stopped_no_new_evidence") throw new CouncilProtocolError("A decision packet requires revealed deliberation");
    const priorRows = await client.query<{ payload: CouncilRoundContribution }>(`SELECT c.payload FROM council_round_contributions c JOIN council_rounds r ON r.round_id = c.round_id WHERE r.council_id = $1 ORDER BY r.round_number, c.department_id`, [councilId]);
    const allowedEvidence = await knownEvidenceReferences(client, council, priorRows.rows.map((row) => row.payload));
    for (const reference of packet.evidenceReferences) if (!allowedEvidence.has(reference.trim())) throw new CouncilProtocolError(`Decision evidence reference is not frozen or recorded: ${reference}`);
    if (packet.outcome === "decided") assertPacketOwnershipIsCaptured(council, packet);
    const state = packet.outcome === "escalated" ? "escalated" : "resolved";
    const updated = await client.query<CouncilRow>("UPDATE head_councils SET state = $2, decision_packet = $3::jsonb, closed_at = transaction_timestamp() WHERE council_id = $1 RETURNING council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash, snapshot_payload", [councilId, state, JSON.stringify(packet)]);
    const next = mapCouncil(updated.rows[0]!);
    await insertProtocolEvent(client, next, packet.outcome === "escalated" ? "decision_escalated" : "decision_resolved", actorContext, { packet }, `decision:${councilId}`);
    return next;
  });
}

/** Executable packets may only assign Departments actually captured as Council participants; no unknown or duplicate owners. */
function assertPacketOwnershipIsCaptured(council: HeadCouncil, packet: DecisionPacket): void {
  const captured = new Set(council.snapshot.participants.map((participant) => participant.departmentId ?? participant.participantId));
  const seenOwnership = new Set<string>();
  for (const ownership of packet.departmentOwnership) {
    if (!captured.has(ownership.departmentId)) throw new CouncilProtocolError(`Decision packet assigns ownership to an uncaptured Department: ${ownership.departmentId}`);
    if (seenOwnership.has(ownership.departmentId)) throw new CouncilProtocolError(`Decision packet duplicates ownership for Department: ${ownership.departmentId}`);
    seenOwnership.add(ownership.departmentId);
  }
  const seenWorkerPlan = new Set<string>();
  for (const item of packet.workerPlan) {
    if (!captured.has(item.departmentId)) throw new CouncilProtocolError(`Decision packet assigns a worker plan to an uncaptured Department: ${item.departmentId}`);
    if (seenWorkerPlan.has(item.departmentId)) throw new CouncilProtocolError(`Decision packet duplicates worker plan for Department: ${item.departmentId}`);
    seenWorkerPlan.add(item.departmentId);
  }
}

export async function listCouncilProtocolEvents(pool: Pool, councilId: string): Promise<readonly CouncilProtocolEvent[]> {
  const council = await readHeadCouncil(pool, councilId);
  const rows = await pool.query<StoredEventRow>(`SELECT event_sequence, event_id, council_id, goal_id, event_type, actor_id, session_ref, command_id, idempotency_key, command_or_idempotency_id, snapshot_hash, evidence_lineage, payload, occurred_at FROM council_protocol_events WHERE council_id = $1 ORDER BY event_sequence`, [councilId]);
  for (const row of rows.rows) {
    if (row.goal_id !== council.goalId || row.snapshot_hash.trim() !== council.snapshotHash) throw new CouncilProtocolError("Council protocol event identity does not match the immutable snapshot");
  }
  return rows.rows.map((row) => ({ eventSequence: row.event_sequence, eventId: row.event_id, councilId: row.council_id, goalId: row.goal_id, eventType: row.event_type, actorId: row.actor_id, sessionRef: row.session_ref, commandId: row.command_id, idempotencyKey: row.idempotency_key, commandOrIdempotencyId: row.command_or_idempotency_id, snapshotHash: row.snapshot_hash.trim(), evidenceLineage: row.evidence_lineage, payload: redactSealedEventPayload(row.event_type, row.payload, council.state), occurredAt: row.occurred_at.toISOString() }));
}

/** Sealed brief content must never be readable through the event stream before reveal. */
function redactSealedEventPayload(eventType: CouncilProtocolEventType, payload: Record<string, unknown>, state: HeadCouncilState): Record<string, unknown> {
  if (eventType !== "brief_submitted" || state !== "collecting") return payload;
  const { brief: _brief, ...redacted } = payload;
  return { ...redacted, brief: "[redacted-until-reveal]" };
}

async function mutateCouncil<T>(pool: Pool, councilId: string, proof: GoalLeaseProof, context: CouncilActorContext | undefined, fallbackIdentity: string, mutation: (client: PoolClient, council: HeadCouncil, context: CouncilActorContext) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const row = await client.query<CouncilRow>(councilSelectSql() + " WHERE council_id = $1 FOR UPDATE", [councilId]);
    if (row.rowCount !== 1) throw new HeadCouncilNotFoundError(`Council not found: ${councilId}`);
    const council = mapCouncil(row.rows[0]!);
    await assertParticipantSnapshot(client, council);
    await assertCouncilCreationAnchor(client, council);
    await assertDecisionAnchor(client, council);
    await assertDurableEvidenceReferences(client, council.goalId, council.snapshot.projectId, council.snapshot.evidence, "Frozen Council evidence");
    if (!validProofFor(council.goalId, proof)) throw new StaleGoalLeaseError(council.goalId);
    await lockGoal(client, proof);
    const actorContext = resolveContext(proof, context, fallbackIdentity);
    const result = await mutation(client, council, actorContext);
    await client.query("COMMIT"); open = false; return result;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function insertProtocolEvent(client: PoolClient, council: HeadCouncil, eventType: CouncilProtocolEventType, context: CouncilActorContext, payload: Record<string, unknown>, fallbackIdentity: string, sessionRefOverride?: string): Promise<void> {
  const identity = context.commandId ?? context.idempotencyKey ?? fallbackIdentity;
  const commandId = context.commandId ?? (context.idempotencyKey === undefined ? identity : null);
  const idempotencyKey = context.idempotencyKey ?? (context.commandId === undefined ? identity : null);
  const lineageReferences = new Set(extractEvidenceReferences(council.snapshot.evidence));
  collectPayloadEvidenceReferences(payload, lineageReferences);
  const lineage = { snapshotHash: council.snapshotHash, evidence: council.snapshot.evidence, evidenceReferences: [...lineageReferences] };
  await client.query(`INSERT INTO council_protocol_events (event_id, council_id, goal_id, event_type, actor_id, session_ref, command_id, idempotency_key, command_or_idempotency_id, snapshot_hash, evidence_lineage, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`, [randomUUID(), council.councilId, council.goalId, eventType, context.actorId, sessionRefOverride ?? context.sessionRef, commandId, idempotencyKey, identity, council.snapshotHash, JSON.stringify(lineage), JSON.stringify(payload)]);
}


interface StoredCreationEventRow {
  goal_id: string;
  snapshot_hash: string;
  payload: Record<string, unknown>;
}

function assertLaunchedTaskContract(row: CouncilTaskContractRow, contractId: string): TaskContractSubstance {
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

async function assertAuthorizedBriefActor(client: PoolClient, council: HeadCouncil, departmentId: string, context: CouncilActorContext): Promise<void> {
  await assertAuthorizedCapturedActor(client, council, departmentId, context);
}

/** Every per-Department Council action (brief, round contribution) must come from the captured, currently active Head, never merely from Goal lease possession. */
async function assertAuthorizedCapturedActor(client: PoolClient, council: HeadCouncil, departmentId: string, context: CouncilActorContext): Promise<void> {
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

async function loadDurableEvidenceReferences(queryable: Pick<Pool | PoolClient, "query">, goalId: string, projectId: string): Promise<Set<string>> {
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

async function assertDurableEvidenceReferences(
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

async function assertCouncilCreationAnchor(queryable: Pick<Pool | PoolClient, "query">, council: HeadCouncil): Promise<void> {
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
async function assertDecisionAnchor(queryable: Pick<Pool | PoolClient, "query">, council: HeadCouncil): Promise<void> {
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

async function assertParticipantSnapshot(queryable: Pick<Pool | PoolClient, "query">, council: HeadCouncil): Promise<void> {
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

async function lockGoal(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

/** A valid lease alone does not authorize Council writes once a Goal is paused, stopping, stopped, or emergency-stopped. */
async function assertGoalControlOpen(client: PoolClient, goalId: string): Promise<void> {
  const result = await client.query<{ paused_at: Date | null; stopping_at: Date | null; stopped_at: Date | null; emergency_stopped_at: Date | null }>(
    `SELECT gc.paused_at, gc.stopping_at, gc.stopped_at, gc.emergency_stopped_at
       FROM goals g
       LEFT JOIN goal_controls gc ON gc.project_id = g.project_id AND gc.goal_id = g.goal_id
      WHERE g.goal_id = $1
      FOR UPDATE OF g`,
    [goalId],
  );
  if (result.rowCount !== 1) throw new CouncilProtocolError("Goal not found for Council authority check");
  const control = result.rows[0]!;
  if (control.emergency_stopped_at !== null) throw new CouncilProtocolError("Goal is emergency-stopped; Council writes are denied");
  if (control.stopped_at !== null) throw new CouncilProtocolError("Goal is stopped; Council writes are denied");
  if (control.stopping_at !== null) throw new CouncilProtocolError("Goal is stopping; Council writes are denied");
  if (control.paused_at !== null) throw new CouncilProtocolError("Goal is paused; Council writes are denied");
}
async function settlementCounts(client: PoolClient, councilId: string): Promise<{ participants: number; briefs: number; absent: number }> { const result = await client.query<{ participants: number; briefs: number; absent: number }>(`SELECT (SELECT count(*)::int FROM council_participants WHERE council_id = $1) participants, (SELECT count(*)::int FROM independent_briefs WHERE council_id = $1) briefs, (SELECT count(*)::int FROM council_participants WHERE council_id = $1 AND absent_at IS NOT NULL) absent`, [councilId]); return result.rows[0]!; }
async function knownEvidenceReferences(client: PoolClient, council: HeadCouncil, prior: readonly CouncilRoundContribution[]): Promise<Set<string>> {
  const durable = await assertDurableEvidenceReferences(client, council.goalId, council.snapshot.projectId, council.snapshot.evidence, "Frozen Council evidence");
  for (const contribution of prior) {
    for (const reference of contribution.newEvidence) {
      if (!durable.has(reference.trim())) throw new CouncilProtocolError(`Recorded Council round evidence is not durable: ${reference}`);
    }
  }
  return durable;
}
function extractEvidenceReferences(value: Readonly<Record<string, unknown>>): readonly string[] {
  const references = new Set<string>();
  collectPayloadEvidenceReferences(value, references);
  return [...references];
}
function collectPayloadEvidenceReferences(value: unknown, references: Set<string>, keyHint?: string): void {
  if (typeof value === "string") {
    if (keyHint !== undefined && ["reference", "references", "evidenceReference", "evidenceReferences", "evidenceId", "evidenceIds", "id", "newEvidence"].includes(keyHint)) {
      if (value.trim() !== "") references.add(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collectPayloadEvidenceReferences(item, references, keyHint); return; }
  if (value !== null && typeof value === "object") for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) collectPayloadEvidenceReferences(candidate, references, key);
}
function briefPayloadHash(brief: IndependentBrief): string { return createHash("sha256").update(canonicalJson(brief)).digest("hex"); }
function requestContext(request: CreateHeadCouncilRequest, proof: GoalLeaseProof): CouncilActorContext | undefined {
  if (request.actorId === undefined && request.sessionRef === undefined && request.commandId === undefined && request.idempotencyKey === undefined) return undefined;
  const context: { actorId: string; sessionRef: string; commandId?: string; idempotencyKey?: string } = { actorId: request.actorId ?? proof.ownerId, sessionRef: request.sessionRef ?? `lease:${proof.ownerId}` };
  if (request.commandId !== undefined) context.commandId = request.commandId;
  if (request.idempotencyKey !== undefined) context.idempotencyKey = request.idempotencyKey;
  return context;
}
function resolveContext(proof: GoalLeaseProof, context: CouncilActorContext | undefined, fallbackIdentity: string): CouncilActorContext {
  const actorId = context?.actorId ?? proof.ownerId;
  const sessionRef = context?.sessionRef ?? `lease:${proof.ownerId}`;
  if (actorId.trim() === "" || sessionRef.trim() === "") throw new CouncilProtocolError("Council actor and session identity are required");
  const resolved: { actorId: string; sessionRef: string; commandId?: string; idempotencyKey?: string } = { actorId, sessionRef };
  if (context?.commandId !== undefined) resolved.commandId = context.commandId;
  if (context?.idempotencyKey !== undefined) resolved.idempotencyKey = context.idempotencyKey;
  else if (context?.commandId === undefined) resolved.idempotencyKey = fallbackIdentity;
  return resolved;
}
function requireState(council: HeadCouncil, state: HeadCouncilState): void { if (council.state !== state) throw new CouncilProtocolError(`Council is ${council.state}, not ${state}`); }
function validProofFor(goalId: string, proof: GoalLeaseProof): boolean { return goalId === proof.goalId && proof.goalId !== "" && proof.ownerId !== "" && isValidFencingToken(proof.fencingToken); }
function councilSelectSql(): string { return "SELECT council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash, snapshot_payload FROM head_councils"; }
function mapCouncil(row: CouncilRow): HeadCouncil {
  const snapshot = hydrateSealedSubmissionSnapshot(row.snapshot_payload, row.snapshot_hash.trim());
  if (row.decision_packet !== null) assertValidDecisionPacket(row.decision_packet);
  if (row.state === "resolved" && row.decision_packet?.outcome !== "decided") throw new CouncilProtocolError("Resolved Council must carry a decided packet");
  if (row.state === "escalated" && row.decision_packet?.outcome !== "escalated") throw new CouncilProtocolError("Escalated Council must carry an escalated packet");
  if (row.state !== "resolved" && row.state !== "escalated" && row.decision_packet !== null) throw new CouncilProtocolError("Only a resolved or escalated Council may carry a decision packet");
  const deadline = row.brief_deadline instanceof Date ? row.brief_deadline.toISOString() : new Date(row.brief_deadline).toISOString();
  if (snapshot.goalId !== row.goal_id || snapshot.contract.contractId !== row.contract_id || snapshot.deadline !== deadline) throw new CouncilProtocolError("Stored Council snapshot does not match its immutable projection");
  return { councilId: row.council_id, goalId: row.goal_id, contractId: row.contract_id, briefDeadline: deadline, state: row.state, noNewEvidenceStreak: row.no_new_evidence_streak, decisionPacket: row.decision_packet, snapshotHash: row.snapshot_hash.trim(), snapshot };
}
