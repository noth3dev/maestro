import { assertValidIndependentBrief, canonicalJson, type IndependentBrief } from "@maestro/domain";
import type { Pool } from "pg";
import type { GoalLeaseProof } from "../commands.js";
import { assertAuthorizedBriefActor, requireState, settlementCounts } from "./guards.js";
import { briefPayloadHash, insertProtocolEvent, mutateCouncil } from "./protocol.js";
import {
  CouncilBriefIdempotencyError,
  CouncilProtocolError,
  type CouncilActorContext,
  type StoredBriefRow,
} from "./types.js";

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
    const participant = await client.query<{ session_ref: string }>("SELECT session_ref FROM council_participants WHERE council_id = $1 AND department_id = $2 AND absent_at IS NULL AND withdrawn_at IS NULL FOR KEY SHARE", [councilId, departmentId]);
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
    const missing = await client.query<{ department_id: string; session_ref: string }>(`SELECT p.department_id, p.session_ref FROM council_participants p LEFT JOIN independent_briefs b ON b.council_id = p.council_id AND b.department_id = p.department_id WHERE p.council_id = $1 AND p.absent_at IS NULL AND p.withdrawn_at IS NULL AND b.department_id IS NULL FOR UPDATE OF p`, [councilId]);
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
      await insertProtocolEvent(client, council, "participant_absent", actorContext, { departmentId: row.department_id, reason, capturedSessionRef: row.session_ref }, `absence:${councilId}:${row.department_id}`);
    }
  });
}

/**
 * A Head whose department is not needed for this Goal withdraws before the
 * deadline instead of submitting a brief. Withdrawal is final and settles the
 * participant for reveal.
 */
export async function withdrawCouncilParticipant(pool: Pool, councilId: string, departmentId: string, reason: string, proof: GoalLeaseProof, context?: CouncilActorContext): Promise<void> {
  if (reason.trim() === "") throw new CouncilProtocolError("Withdrawal needs a reason");
  await mutateCouncil(pool, councilId, proof, context, `withdrawal:${councilId}:${departmentId}`, async (client, council, actorContext) => {
    await assertAuthorizedBriefActor(client, council, departmentId, actorContext);
    const row = await client.query<{ withdrawn_at: Date | null; withdrawal_reason: string | null; absent_at: Date | null; has_brief: boolean }>(
      "SELECT p.withdrawn_at, p.withdrawal_reason, p.absent_at, EXISTS (SELECT 1 FROM independent_briefs b WHERE b.council_id = p.council_id AND b.department_id = p.department_id) AS has_brief FROM council_participants p WHERE p.council_id = $1 AND p.department_id = $2 FOR UPDATE",
      [councilId, departmentId],
    );
    const participant = row.rows[0];
    if (participant === undefined) throw new CouncilProtocolError("Only a captured Council participant may withdraw");
    if (participant.withdrawn_at !== null) {
      if (participant.withdrawal_reason !== reason.trim()) throw new CouncilBriefIdempotencyError("Withdrawal was already recorded with a different reason");
      return;
    }
    requireState(council, "collecting");
    if (participant.absent_at !== null) throw new CouncilProtocolError("An absent participant cannot withdraw");
    if (participant.has_brief) throw new CouncilProtocolError("A Head that submitted a brief cannot withdraw");
    await client.query("UPDATE council_participants SET withdrawn_at = clock_timestamp(), withdrawal_reason = $3 WHERE council_id = $1 AND department_id = $2", [councilId, departmentId, reason.trim()]);
    await insertProtocolEvent(client, council, "participant_withdrew", actorContext, { departmentId, reason: reason.trim() }, `withdrawal:${councilId}:${departmentId}`);
  });
}

export async function revealCouncilBriefs(pool: Pool, councilId: string, proof: GoalLeaseProof, context?: CouncilActorContext): Promise<void> {
  await mutateCouncil(pool, councilId, proof, context, `reveal:${councilId}`, async (client, council, actorContext) => {
    requireState(council, "collecting");
    const counts = await settlementCounts(client, councilId);
    // Every Head settled before the deadline; at least one must have a brief to reveal.
    const allSubmitted = counts.briefs > 0 && counts.briefs + counts.withdrawn === counts.participants && counts.absent === 0;
    const deadline = await client.query<{ elapsed: boolean }>("SELECT clock_timestamp() >= $1::timestamptz AS elapsed", [council.briefDeadline]);
    const deadlineSettled = deadline.rowCount === 1 && deadline.rows[0]!.elapsed && counts.briefs + counts.absent + counts.withdrawn === counts.participants;
    if (!allSubmitted && !deadlineSettled) throw new CouncilProtocolError("Briefs remain sealed until every Head submits or withdraws, or every deadline-missing participant is marked absent");
    await client.query("UPDATE head_councils SET state = 'revealed', revealed_at = clock_timestamp() WHERE council_id = $1", [councilId]);
    await insertProtocolEvent(client, council, "briefs_revealed", actorContext, { briefs: counts.briefs, absent: counts.absent, withdrawn: counts.withdrawn }, `reveal:${councilId}`);
  });
}
