import { randomUUID } from "node:crypto";
import { assertValidCouncilRoundContribution, assertValidDecisionPacket, assertValidIndependentBrief, freezeSealedSubmissionSnapshot, isMaterialCouncilRound, type CouncilRoundContribution, type DecisionPacket, type IndependentBrief } from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";

export type HeadCouncilState = "collecting" | "revealed" | "resolved" | "escalated" | "stopped_no_new_evidence";
export interface HeadCouncil { readonly councilId: string; readonly goalId: string; readonly contractId: string; readonly briefDeadline: Date; readonly state: HeadCouncilState; readonly noNewEvidenceStreak: number; readonly decisionPacket: DecisionPacket | null; readonly snapshotHash: string; }
export interface CreateHeadCouncilRequest { readonly councilId?: string; readonly goalId: string; readonly contractId: string; readonly briefDeadline: Date; }
export interface RoundInput { readonly departmentId: string; readonly contribution: CouncilRoundContribution; }
export class HeadCouncilNotFoundError extends Error {}
export class CouncilProtocolError extends Error {}
export class CouncilBriefsSealedError extends Error {}

type CouncilRow = { council_id: string; goal_id: string; contract_id: string; brief_deadline: Date; state: HeadCouncilState; no_new_evidence_streak: number; decision_packet: DecisionPacket | null; snapshot_hash: string };

export async function createHeadCouncil(pool: Pool, request: CreateHeadCouncilRequest, proof: GoalLeaseProof): Promise<HeadCouncil> {
  if (!validProofFor(request.goalId, proof) || request.contractId === "" || Number.isNaN(request.briefDeadline.valueOf())) throw new StaleGoalLeaseError(request.goalId);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true; await lockGoal(client, proof);
    const participants = await client.query<{ department_id: string; active_session_ref: string }>(`SELECT department_id, active_session_ref FROM goal_head_participations WHERE goal_id = $1 AND contract_id = $2 AND status = 'active' ORDER BY department_id FOR KEY SHARE`, [request.goalId, request.contractId]);
    if (participants.rowCount === 0) throw new CouncilProtocolError("A Head Council requires active Heads bound to the selected contract");
    const goalRow = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1 FOR KEY SHARE", [request.goalId]);
    if (goalRow.rowCount !== 1) throw new CouncilProtocolError("Goal not found for Head Council creation");
    const contractRow = await client.query<{ version: string; content: Record<string, unknown>; content_hash: string }>("SELECT version, content, content_hash FROM task_contracts WHERE contract_id = $1 FOR KEY SHARE", [request.contractId]);
    if (contractRow.rowCount !== 1) throw new CouncilProtocolError("Task Contract not found for Head Council creation");
    const contract = contractRow.rows[0]!;
    const snapshot = freezeSealedSubmissionSnapshot({
      projectId: goalRow.rows[0]!.project_id,
      goalId: request.goalId,
      contract: { contractId: request.contractId, version: Number(contract.version), contentHash: contract.content_hash, content: contract.content },
      participants: participants.rows.map((row) => ({ participantId: row.department_id, sessionRef: row.active_session_ref })),
      evidence: {},
      deadline: request.briefDeadline,
    });
    const councilId = request.councilId ?? randomUUID();
    const inserted = await client.query<CouncilRow>(`INSERT INTO head_councils (council_id, goal_id, contract_id, brief_deadline, state, snapshot_hash) VALUES ($1, $2, $3, $4, 'collecting', $5) RETURNING council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash`, [councilId, request.goalId, request.contractId, request.briefDeadline, snapshot.snapshotHash]);
    for (const participant of participants.rows) await client.query("INSERT INTO council_participants (council_id, department_id) VALUES ($1, $2)", [councilId, participant.department_id]);
    await client.query("COMMIT"); open = false; return mapCouncil(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function submitIndependentBrief(pool: Pool, councilId: string, departmentId: string, brief: IndependentBrief, proof: GoalLeaseProof): Promise<void> {
  assertValidIndependentBrief(brief);
  await mutateCouncil(pool, councilId, proof, async (client, council) => {
    requireState(council, "collecting");
    const participant = await client.query("SELECT 1 FROM council_participants WHERE council_id = $1 AND department_id = $2 AND absent_at IS NULL FOR KEY SHARE", [councilId, departmentId]);
    if (participant.rowCount !== 1) throw new CouncilProtocolError("Only a present captured Council participant may submit a brief");
    const inserted = await client.query("INSERT INTO independent_briefs (council_id, department_id, payload) VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING RETURNING council_id", [councilId, departmentId, JSON.stringify(brief)]);
    if (inserted.rowCount !== 1) throw new CouncilProtocolError("A participant may submit exactly one independent brief");
  });
}

/** Missing Heads become absent only after the deadline, with an auditable nonblank reason. */
export async function markMissingCouncilParticipantsAbsent(pool: Pool, councilId: string, reasons: Readonly<Record<string, string>>, proof: GoalLeaseProof): Promise<void> {
  await mutateCouncil(pool, councilId, proof, async (client, council) => {
    requireState(council, "collecting");
    const deadline = await client.query("SELECT transaction_timestamp() >= $2 AS elapsed", [councilId, council.briefDeadline]);
    if (!deadline.rows[0]!.elapsed) throw new CouncilProtocolError("Brief deadline has not passed");
    const missing = await client.query<{ department_id: string }>(`SELECT p.department_id FROM council_participants p LEFT JOIN independent_briefs b ON b.council_id = p.council_id AND b.department_id = p.department_id WHERE p.council_id = $1 AND p.absent_at IS NULL AND b.department_id IS NULL FOR UPDATE OF p`, [councilId]);
    for (const row of missing.rows) {
      const reason = reasons[row.department_id];
      if (typeof reason !== "string" || reason.trim() === "") throw new CouncilProtocolError(`Missing absence reason for ${row.department_id}`);
    }
    if (Object.keys(reasons).some((departmentId) => !missing.rows.some((row) => row.department_id === departmentId))) throw new CouncilProtocolError("Absence reasons may name only missing participants");
    for (const row of missing.rows) await client.query("UPDATE council_participants SET absence_reason = $3, absent_at = transaction_timestamp() WHERE council_id = $1 AND department_id = $2", [councilId, row.department_id, reasons[row.department_id]!.trim()]);
  });
}

export async function revealCouncilBriefs(pool: Pool, councilId: string, proof: GoalLeaseProof): Promise<void> {
  await mutateCouncil(pool, councilId, proof, async (client, council) => {
    requireState(council, "collecting");
    const counts = await settlementCounts(client, councilId);
    const allSubmitted = counts.briefs === counts.participants;
    const deadline = await client.query<{ elapsed: boolean }>("SELECT transaction_timestamp() >= $1 AS elapsed", [council.briefDeadline]);
    const deadlineSettled = deadline.rows[0]!.elapsed && counts.briefs + counts.absent === counts.participants;
    if (!allSubmitted && !deadlineSettled) throw new CouncilProtocolError("Briefs remain sealed until all submit or every deadline-missing participant is marked absent");
    await client.query("UPDATE head_councils SET state = 'revealed', revealed_at = transaction_timestamp() WHERE council_id = $1", [councilId]);
  });
}

export async function readRevealedCouncilBriefs(pool: Pool, councilId: string): Promise<readonly { departmentId: string; brief: IndependentBrief; submittedAt: Date }[]> {
  const council = await pool.query<CouncilRow>("SELECT council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash FROM head_councils WHERE council_id = $1", [councilId]);
  if (council.rowCount !== 1) throw new HeadCouncilNotFoundError(`Council not found: ${councilId}`);
  if (council.rows[0]!.state === "collecting") throw new CouncilBriefsSealedError("Independent briefs are sealed before reveal");
  const rows = await pool.query<{ department_id: string; payload: IndependentBrief; submitted_at: Date }>("SELECT department_id, payload, submitted_at FROM independent_briefs WHERE council_id = $1 ORDER BY submitted_at, department_id", [councilId]);
  return rows.rows.map((row) => ({ departmentId: row.department_id, brief: row.payload, submittedAt: row.submitted_at }));
}

/** Adds one protocol round. Materiality is derived exclusively from validated contribution content. */
export async function recordCouncilRound(pool: Pool, councilId: string, contributions: readonly RoundInput[], proof: GoalLeaseProof): Promise<HeadCouncil> {
  const seen = new Set<string>();
  for (const entry of contributions) { if (seen.has(entry.departmentId)) throw new CouncilProtocolError("A participant may contribute once per round"); seen.add(entry.departmentId); assertValidCouncilRoundContribution(entry.contribution); }
  return mutateCouncil(pool, councilId, proof, async (client, council) => {
    requireState(council, "revealed");
    for (const entry of contributions) {
      const participant = await client.query("SELECT 1 FROM council_participants WHERE council_id = $1 AND department_id = $2 AND absent_at IS NULL FOR KEY SHARE", [councilId, entry.departmentId]);
      if (participant.rowCount !== 1) throw new CouncilProtocolError("Only present Council participants may deliberate");
    }
    const prior = await client.query<{ round_number: number }>("SELECT round_number FROM council_rounds WHERE council_id = $1 ORDER BY round_number DESC LIMIT 1 FOR UPDATE", [councilId]);
    const material = contributions.some((entry) => isMaterialCouncilRound(entry.contribution));
    const roundId = randomUUID(); const number = (prior.rows[0]?.round_number ?? 0) + 1;
    await client.query("INSERT INTO council_rounds (round_id, council_id, round_number, has_material_contribution) VALUES ($1, $2, $3, $4)", [roundId, councilId, number, material]);
    for (const entry of contributions) await client.query("INSERT INTO council_round_contributions (contribution_id, round_id, department_id, payload) VALUES ($1, $2, $3, $4::jsonb)", [randomUUID(), roundId, entry.departmentId, JSON.stringify(entry.contribution)]);
    const streak = material ? 0 : council.noNewEvidenceStreak + 1;
    const stopped = streak >= 2;
    const updated = await client.query<CouncilRow>("UPDATE head_councils SET no_new_evidence_streak = $2, state = CASE WHEN $3 THEN 'stopped_no_new_evidence' ELSE state END, closed_at = CASE WHEN $3 THEN transaction_timestamp() ELSE closed_at END WHERE council_id = $1 RETURNING council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash", [councilId, streak, stopped]);
    return mapCouncil(updated.rows[0]!);
  });
}

export async function recordCouncilDecisionPacket(pool: Pool, councilId: string, packet: DecisionPacket, proof: GoalLeaseProof): Promise<HeadCouncil> {
  assertValidDecisionPacket(packet);
  return mutateCouncil(pool, councilId, proof, async (client, council) => {
    if (council.state !== "revealed" && council.state !== "stopped_no_new_evidence") throw new CouncilProtocolError("A decision packet requires revealed deliberation");
    const state = packet.outcome === "escalated" ? "escalated" : "resolved";
    const updated = await client.query<CouncilRow>("UPDATE head_councils SET state = $2, decision_packet = $3::jsonb, closed_at = transaction_timestamp() WHERE council_id = $1 RETURNING council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash", [councilId, state, JSON.stringify(packet)]);
    return mapCouncil(updated.rows[0]!);
  });
}

async function mutateCouncil<T>(pool: Pool, councilId: string, proof: GoalLeaseProof, mutation: (client: PoolClient, council: HeadCouncil) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let open = false;
  try { await client.query("BEGIN"); open = true; const row = await client.query<CouncilRow>("SELECT council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash FROM head_councils WHERE council_id = $1 FOR UPDATE", [councilId]); if (row.rowCount !== 1) throw new HeadCouncilNotFoundError(`Council not found: ${councilId}`); const council = mapCouncil(row.rows[0]!); if (!validProofFor(council.goalId, proof)) throw new StaleGoalLeaseError(council.goalId); await lockGoal(client, proof); const result = await mutation(client, council); await client.query("COMMIT"); open = false; return result; } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function lockGoal(client: PoolClient, proof: GoalLeaseProof): Promise<void> { const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > transaction_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]); if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId); await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [proof.goalId]); }
async function settlementCounts(client: PoolClient, councilId: string): Promise<{ participants: number; briefs: number; absent: number }> { const result = await client.query<{ participants: number; briefs: number; absent: number }>(`SELECT (SELECT count(*)::int FROM council_participants WHERE council_id = $1) participants, (SELECT count(*)::int FROM independent_briefs WHERE council_id = $1) briefs, (SELECT count(*)::int FROM council_participants WHERE council_id = $1 AND absent_at IS NOT NULL) absent`, [councilId]); return result.rows[0]!; }
function requireState(council: HeadCouncil, state: HeadCouncilState): void { if (council.state !== state) throw new CouncilProtocolError(`Council is ${council.state}, not ${state}`); }
function validProofFor(goalId: string, proof: GoalLeaseProof): boolean { return goalId === proof.goalId && proof.goalId !== "" && proof.ownerId !== "" && isValidFencingToken(proof.fencingToken); }
function mapCouncil(row: CouncilRow): HeadCouncil { return { councilId: row.council_id, goalId: row.goal_id, contractId: row.contract_id, briefDeadline: row.brief_deadline, state: row.state, noNewEvidenceStreak: row.no_new_evidence_streak, decisionPacket: row.decision_packet, snapshotHash: row.snapshot_hash }; }
