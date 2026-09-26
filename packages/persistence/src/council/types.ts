import type {
  CouncilRoundContribution,
  DecisionPacket,
  IndependentBrief,
  SealedSubmissionParticipant,
  SealedSubmissionSnapshot,
} from "@maestro/domain";

export type HeadCouncilState = "collecting" | "revealed" | "resolved" | "escalated" | "stopped_no_new_evidence";
export type CouncilProtocolEventType = "council_created" | "brief_submitted" | "participant_absent" | "participant_withdrew" | "briefs_revealed" | "round_recorded" | "council_stopped" | "decision_resolved" | "decision_escalated";

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

export interface CouncilRow {
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

export interface CouncilTaskContractRow {
  schema_version: number;
  version: string;
  content: unknown;
  content_hash: string;
  launch_state: string;
}

export interface StoredBriefRow {
  department_id: string;
  payload: IndependentBrief;
  payload_hash: string;
  idempotency_key: string;
  submitted_at: Date;
}

export interface StoredEventRow {
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

export interface StoredCreationEventRow {
  goal_id: string;
  snapshot_hash: string;
  payload: Record<string, unknown>;
}
