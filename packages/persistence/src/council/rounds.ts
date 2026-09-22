import { randomUUID } from "node:crypto";
import {
  assertValidCouncilRoundContribution,
  assertValidDecisionPacket,
  canonicalJson,
  isMaterialCouncilRound,
  type CouncilRoundContribution,
  type DecisionPacket,
} from "@maestro/domain";
import type { Pool } from "pg";
import type { GoalLeaseProof } from "../commands.js";
import { assertAuthorizedCapturedActor, knownEvidenceReferences, requireState } from "./guards.js";
import { insertProtocolEvent, mapCouncil, mutateCouncil } from "./protocol.js";
import {
  CouncilProtocolError,
  type CouncilActorContext,
  type CouncilRow,
  type HeadCouncil,
  type RoundInput,
} from "./types.js";

/** Adds one protocol round. All present participants must contribute exactly once. */
export async function recordCouncilRound(pool: Pool, councilId: string, contributions: readonly RoundInput[], proof: GoalLeaseProof, context?: CouncilActorContext): Promise<HeadCouncil> {
  const seen = new Set<string>();
  for (const entry of contributions) { if (seen.has(entry.departmentId)) throw new CouncilProtocolError("A participant may contribute once per round"); seen.add(entry.departmentId); assertValidCouncilRoundContribution(entry.contribution); }
  const canonicalContributions = (input: readonly RoundInput[]): string =>
    canonicalJson([...input].sort((a, b) => (a.departmentId < b.departmentId ? -1 : a.departmentId > b.departmentId ? 1 : 0)).map((entry) => ({ departmentId: entry.departmentId, contribution: entry.contribution })));
  // Idempotent replay is opt-in via an explicit commandId/idempotencyKey.
  // Two genuinely distinct rounds are allowed to carry identical content
  // (e.g. deliberately repeating a round to trigger the no-new-evidence
  // stop rule), so a content-derived fallback would wrongly deduplicate
  // them; a contextless call always records a new round.
  const explicitIdentity = context?.commandId ?? context?.idempotencyKey;
  const fallbackIdentity = `round:${councilId}:${randomUUID()}`;
  return mutateCouncil(pool, councilId, proof, context, fallbackIdentity, async (client, council, actorContext) => {
    // Authorize every contributor before consulting any replay identity: a
    // caller who merely guesses/replays an identity must not observe a
    // result without itself being an authorized captured Head.
    for (const entry of contributions) await assertAuthorizedCapturedActor(client, council, entry.departmentId, entry.submittedBy);
    if (explicitIdentity !== undefined) {
      const existingRound = await client.query<{ payload: Record<string, unknown> }>(
        "SELECT payload FROM council_protocol_events WHERE council_id = $1 AND event_type = 'round_recorded' AND command_or_idempotency_id = $2 FOR KEY SHARE",
        [councilId, explicitIdentity],
      );
      if ((existingRound.rowCount ?? 0) > 0) {
        const priorContributions = existingRound.rows[0]!.payload.contributions as readonly RoundInput[];
        if (canonicalContributions(priorContributions) !== canonicalContributions(contributions)) throw new CouncilProtocolError("Council round idempotency identity was reused with different content");
        // Idempotent retry: `council` was freshly loaded by mutateCouncil and
        // already reflects this round's effects (and any later operations).
        return council;
      }
    }
    requireState(council, "revealed");
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
    await insertProtocolEvent(client, council, "round_recorded", actorContext, { roundId, roundNumber: number, material, contributions }, explicitIdentity ?? fallbackIdentity);
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
