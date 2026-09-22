import { assertValidIndependentBrief, type IndependentBrief } from "@maestro/domain";
import type { Pool } from "pg";
import {
  assertCouncilCreationAnchor,
  assertDecisionAnchor,
  assertDurableEvidenceReferences,
  assertParticipantSnapshot,
} from "./guards.js";
import { briefPayloadHash, councilSelectSql, mapCouncil } from "./protocol.js";
import {
  CouncilBriefsSealedError,
  CouncilProtocolError,
  HeadCouncilNotFoundError,
  type CouncilProtocolEvent,
  type CouncilProtocolEventType,
  type CouncilRow,
  type HeadCouncil,
  type HeadCouncilState,
  type StoredEventRow,
} from "./types.js";

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

export async function readRevealedCouncilBriefs(pool: Pool, councilId: string): Promise<readonly { departmentId: string; brief: IndependentBrief; submittedAt: string }[]> {
  const council = await readHeadCouncil(pool, councilId);
  if (council.state === "collecting") throw new CouncilBriefsSealedError("Independent briefs are sealed before reveal");
  const rows = await pool.query<{ department_id: string; payload: IndependentBrief; payload_hash: string; submitted_at: Date }>("SELECT department_id, payload, payload_hash, submitted_at FROM independent_briefs WHERE council_id = $1 ORDER BY submitted_at, department_id", [councilId]);
  return rows.rows.map((row) => {
    assertValidIndependentBrief(row.payload);
    if (briefPayloadHash(row.payload) !== row.payload_hash.trim()) throw new CouncilProtocolError(`Revealed brief content does not match its recorded hash: ${row.department_id}`);
    return { departmentId: row.department_id, brief: row.payload, submittedAt: row.submitted_at.toISOString() };
  });
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
