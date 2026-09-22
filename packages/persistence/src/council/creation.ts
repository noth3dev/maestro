import { randomUUID } from "node:crypto";
import { freezeSealedSubmissionSnapshot } from "@maestro/domain";
import type { Pool } from "pg";
import { StaleGoalLeaseError, type GoalLeaseProof } from "../commands.js";
import { assertDurableEvidenceReferences, assertLaunchedTaskContract, lockGoal, validProofFor } from "./guards.js";
import { insertProtocolEvent, mapCouncil, resolveContext } from "./protocol.js";
import {
  CouncilProtocolError,
  toHeadCouncilParticipant,
  type CouncilActorContext,
  type CouncilRow,
  type CouncilTaskContractRow,
  type CreateHeadCouncilRequest,
  type HeadCouncil,
} from "./types.js";

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
    const contractProjectId = contractContent.project.projectId;
    if (contractProjectId.trim() !== goalRow.rows[0]!.project_id) {
      throw new CouncilProtocolError("Task Contract project identity does not match the Goal's project");
    }
    await assertDurableEvidenceReferences(client, request.goalId, goalRow.rows[0]!.project_id, request.evidence, "Frozen Council evidence");
    await assertDurableEvidenceReferences(client, request.goalId, goalRow.rows[0]!.project_id, { evidenceReferences: contractContent.evidenceReferences }, "Frozen Task Contract evidence");
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
      contract: { contractId: request.contractId, version: Number(contract.version), contentHash: contract.content_hash.trim(), content: Object.fromEntries(Object.entries(contractContent)) },
      participants: participants.rows.map((row) => toHeadCouncilParticipant({
        headRoleId: row.head_role_id,
        departmentId: row.department_id,
        sessionRef: row.active_session_ref,
      })),
      evidence: request.evidence,
      deadline: request.briefDeadline,
    });
    // Check for an existing Council by durable identity first: a retry whose
    // original deadline has since elapsed while its response was lost must
    // still return the prior Council, not fail on a now-past deadline.
    const existingByIdentity = await client.query<CouncilRow>(`SELECT council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak, decision_packet, snapshot_hash, snapshot_payload FROM head_councils WHERE goal_id = $1 AND contract_id = $2`, [request.goalId, request.contractId]);
    if ((existingByIdentity.rowCount ?? 0) > 0) {
      const prior = existingByIdentity.rows[0]!;
      if (prior.snapshot_hash.trim() === snapshot.snapshotHash) { await client.query("COMMIT"); open = false; return mapCouncil(prior); }
      throw new CouncilProtocolError("A Head Council already exists for this Goal and Task Contract");
    }
    const deadlineCheck = await client.query<{ inFuture: boolean }>("SELECT clock_timestamp() < $1::timestamptz AS \"inFuture\"", [snapshot.deadline]);
    if (deadlineCheck.rowCount !== 1 || !deadlineCheck.rows[0]!.inFuture) throw new CouncilProtocolError("Head Council brief deadline must be in the future");
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

function requestContext(request: CreateHeadCouncilRequest, proof: GoalLeaseProof): CouncilActorContext | undefined {
  if (request.actorId === undefined && request.sessionRef === undefined && request.commandId === undefined && request.idempotencyKey === undefined) return undefined;
  const context: { actorId: string; sessionRef: string; commandId?: string; idempotencyKey?: string } = { actorId: request.actorId ?? proof.ownerId, sessionRef: request.sessionRef ?? `lease:${proof.ownerId}` };
  if (request.commandId !== undefined) context.commandId = request.commandId;
  if (request.idempotencyKey !== undefined) context.idempotencyKey = request.idempotencyKey;
  return context;
}
