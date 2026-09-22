import { createHash, randomUUID } from "node:crypto";
import { assertValidDecisionPacket, canonicalJson, hydrateSealedSubmissionSnapshot, type IndependentBrief } from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, type GoalLeaseProof } from "../commands.js";
import {
  assertCouncilCreationAnchor,
  assertDecisionAnchor,
  assertDurableEvidenceReferences,
  assertParticipantSnapshot,
  collectPayloadEvidenceReferences,
  extractEvidenceReferences,
  lockGoal,
  validProofFor,
} from "./guards.js";
import {
  CouncilProtocolError,
  HeadCouncilNotFoundError,
  type CouncilActorContext,
  type CouncilProtocolEventType,
  type CouncilRow,
  type HeadCouncil,
} from "./types.js";

export function councilSelectSql(): string { return "SELECT council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash, snapshot_payload FROM head_councils"; }

export function mapCouncil(row: CouncilRow): HeadCouncil {
  const snapshot = hydrateSealedSubmissionSnapshot(row.snapshot_payload, row.snapshot_hash.trim());
  if (row.decision_packet !== null) assertValidDecisionPacket(row.decision_packet);
  if (row.state === "resolved" && row.decision_packet?.outcome !== "decided") throw new CouncilProtocolError("Resolved Council must carry a decided packet");
  if (row.state === "escalated" && row.decision_packet?.outcome !== "escalated") throw new CouncilProtocolError("Escalated Council must carry an escalated packet");
  if (row.state !== "resolved" && row.state !== "escalated" && row.decision_packet !== null) throw new CouncilProtocolError("Only a resolved or escalated Council may carry a decision packet");
  const deadline = row.brief_deadline instanceof Date ? row.brief_deadline.toISOString() : new Date(row.brief_deadline).toISOString();
  if (snapshot.goalId !== row.goal_id || snapshot.contract.contractId !== row.contract_id || snapshot.deadline !== deadline) throw new CouncilProtocolError("Stored Council snapshot does not match its immutable projection");
  return { councilId: row.council_id, goalId: row.goal_id, contractId: row.contract_id, briefDeadline: deadline, state: row.state, noNewEvidenceStreak: row.no_new_evidence_streak, decisionPacket: row.decision_packet, snapshotHash: row.snapshot_hash.trim(), snapshot };
}

export function briefPayloadHash(brief: IndependentBrief): string { return createHash("sha256").update(canonicalJson(brief)).digest("hex"); }

export function resolveContext(proof: GoalLeaseProof, context: CouncilActorContext | undefined, fallbackIdentity: string): CouncilActorContext {
  const actorId = context?.actorId ?? proof.ownerId;
  const sessionRef = context?.sessionRef ?? `lease:${proof.ownerId}`;
  if (actorId.trim() === "" || sessionRef.trim() === "") throw new CouncilProtocolError("Council actor and session identity are required");
  const resolved: { actorId: string; sessionRef: string; commandId?: string; idempotencyKey?: string } = { actorId, sessionRef };
  if (context?.commandId !== undefined) resolved.commandId = context.commandId;
  if (context?.idempotencyKey !== undefined) resolved.idempotencyKey = context.idempotencyKey;
  else if (context?.commandId === undefined) resolved.idempotencyKey = fallbackIdentity;
  return resolved;
}

export async function mutateCouncil<T>(pool: Pool, councilId: string, proof: GoalLeaseProof, context: CouncilActorContext | undefined, fallbackIdentity: string, mutation: (client: PoolClient, council: HeadCouncil, context: CouncilActorContext) => Promise<T>): Promise<T> {
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

export async function insertProtocolEvent(client: PoolClient, council: HeadCouncil, eventType: CouncilProtocolEventType, context: CouncilActorContext, payload: Record<string, unknown>, fallbackIdentity: string, sessionRefOverride?: string): Promise<void> {
  const identity = context.commandId ?? context.idempotencyKey ?? fallbackIdentity;
  const commandId = context.commandId ?? (context.idempotencyKey === undefined ? identity : null);
  const idempotencyKey = context.idempotencyKey ?? (context.commandId === undefined ? identity : null);
  const lineageReferences = new Set(extractEvidenceReferences(council.snapshot.evidence));
  collectPayloadEvidenceReferences(payload, lineageReferences);
  const lineage = { snapshotHash: council.snapshotHash, evidence: council.snapshot.evidence, evidenceReferences: [...lineageReferences] };
  await client.query(`INSERT INTO council_protocol_events (event_id, council_id, goal_id, event_type, actor_id, session_ref, command_id, idempotency_key, command_or_idempotency_id, snapshot_hash, evidence_lineage, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`, [randomUUID(), council.councilId, council.goalId, eventType, context.actorId, sessionRefOverride ?? context.sessionRef, commandId, idempotencyKey, identity, council.snapshotHash, JSON.stringify(lineage), JSON.stringify(payload)]);
}
