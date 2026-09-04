import { randomUUID } from "node:crypto";
import {
  assertValidDepartmentPlanSubstance,
  canonicalJson,
  decisionPacketContentHash,
  departmentPlanSubstanceContentHash,
  isExecutableDecisionPacket,
  type DepartmentPlan,
  type DepartmentPlanSubstance,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext, type HeadCouncil } from "./council.js";

export class DepartmentPlanError extends Error {}
export class DepartmentPlanNotFoundError extends DepartmentPlanError {}

export interface CreateDepartmentPlanRequest {
  readonly councilId: string;
  readonly departmentId: string;
  readonly substance: DepartmentPlanSubstance;
}

interface DepartmentPlanRow {
  council_id: string;
  department_id: string;
  project_id: string;
  goal_id: string;
  head_role_id: string;
  council_snapshot_hash: string;
  decision_packet_hash: string;
  contract_id: string;
  contract_version: string;
  contract_content_hash: string;
  current_version: number;
  substance: DepartmentPlanSubstance;
  content_hash: string;
}

function mapPlan(row: DepartmentPlanRow): DepartmentPlan {
  return {
    projectId: row.project_id,
    goalId: row.goal_id,
    councilId: row.council_id,
    councilSnapshotHash: row.council_snapshot_hash.trim(),
    decisionPacketHash: row.decision_packet_hash.trim(),
    contractId: row.contract_id,
    contractVersion: Number(row.contract_version),
    contractContentHash: row.contract_content_hash.trim(),
    departmentId: row.department_id,
    headRoleId: row.head_role_id,
    version: row.current_version,
    substance: row.substance,
    contentHash: row.content_hash.trim(),
  };
}

function planSelectSql(): string {
  return "SELECT council_id, department_id, project_id, goal_id, head_role_id, council_snapshot_hash, decision_packet_hash, contract_id, contract_version, contract_content_hash, current_version, substance, content_hash FROM department_plans";
}

/** The caller must be the currently active, captured Head for this Department -- not merely the Goal lease holder. */
async function assertAuthorizedPlanOwner(client: PoolClient, council: HeadCouncil, departmentId: string, context: CouncilActorContext): Promise<{ headRoleId: string }> {
  const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
  if (captured === undefined) throw new DepartmentPlanError("Department is not a captured Council participant");
  const authorized = captured.headRoleId !== undefined
    ? isAuthorizedHeadCouncilActor(context, captured)
    : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
  if (!authorized) throw new DepartmentPlanError("Department Plan actor is not bound to the captured Head identity and session");
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
  if (active.rowCount !== 1) throw new DepartmentPlanError("Captured Head session is no longer authorized");
  return { headRoleId: captured.headRoleId ?? captured.participantId };
}

function assertGoalProofOrThrow(goalId: string, proof: GoalLeaseProof): void {
  if (goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
}

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 14))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

/**
 * Create the first version of one Department's Plan. Every identity/binding
 * field is derived from the resolved, executable Council decision loaded
 * inside this transaction -- never trusted from the request. One plan per
 * (councilId, departmentId); an identical-content retry is idempotent, a
 * differing-content retry is a conflict.
 */
export async function createDepartmentPlan(pool: Pool, request: CreateDepartmentPlanRequest, proof: GoalLeaseProof, context: CouncilActorContext): Promise<DepartmentPlan> {
  assertValidDepartmentPlanSubstance(request.substance);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const council = await readHeadCouncil(pool, request.councilId);
    assertGoalProofOrThrow(council.goalId, proof);
    await lockGoalLease(client, proof);
    if (council.state !== "resolved" || council.decisionPacket === null || !isExecutableDecisionPacket(council.decisionPacket)) {
      throw new DepartmentPlanError("A Department Plan requires a resolved, executable Council decision");
    }
    // `readHeadCouncil` used a separate connection with no lock. Re-verify the
    // exact resolved state/hashes inside this transaction (which already
    // holds the Goal lease/control lock) before writing, so a concurrent
    // change between that read and this write cannot be silently trusted.
    const anchor = await client.query<{ state: string; decision_packet: unknown; snapshot_hash: string }>(
      "SELECT state, decision_packet, snapshot_hash FROM head_councils WHERE council_id = $1 FOR KEY SHARE",
      [request.councilId],
    );
    if (anchor.rowCount !== 1 || anchor.rows[0]!.state !== "resolved" || anchor.rows[0]!.snapshot_hash.trim() !== council.snapshotHash || canonicalJson(anchor.rows[0]!.decision_packet) !== canonicalJson(council.decisionPacket)) {
      throw new DepartmentPlanError("Council resolved state changed between read and Department Plan creation");
    }
    if (!council.decisionPacket.departmentOwnership.some((ownership) => ownership.departmentId === request.departmentId)) {
      throw new DepartmentPlanError("The Council decision did not assign ownership to this Department");
    }
    const { headRoleId } = await assertAuthorizedPlanOwner(client, council, request.departmentId, context);
    const contentHash = departmentPlanSubstanceContentHash(request.substance);
    const existing = await client.query<DepartmentPlanRow>(planSelectSql() + " WHERE council_id = $1 AND department_id = $2 FOR UPDATE", [request.councilId, request.departmentId]);
    if ((existing.rowCount ?? 0) > 0) {
      const prior = existing.rows[0]!;
      if (prior.content_hash.trim() === contentHash && prior.current_version === 1) { await client.query("COMMIT"); open = false; return mapPlan(prior); }
      throw new DepartmentPlanError("A Department Plan already exists for this Council and Department");
    }
    const contractRow = await client.query<{ version: string; content_hash: string }>("SELECT version, content_hash FROM task_contracts WHERE contract_id = $1", [council.contractId]);
    if (contractRow.rowCount !== 1) throw new DepartmentPlanError("Frozen Task Contract not found for Department Plan");
    const contract = contractRow.rows[0]!;
    const decisionHash = decisionPacketContentHash(council.decisionPacket);
    const inserted = await client.query<DepartmentPlanRow>(
      `INSERT INTO department_plans (council_id, department_id, project_id, goal_id, head_role_id, council_snapshot_hash, decision_packet_hash, contract_id, contract_version, contract_content_hash, current_version, substance, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11::jsonb, $12)
       RETURNING council_id, department_id, project_id, goal_id, head_role_id, council_snapshot_hash, decision_packet_hash, contract_id, contract_version, contract_content_hash, current_version, substance, content_hash`,
      [request.councilId, request.departmentId, council.snapshot.projectId, council.goalId, headRoleId, council.snapshotHash, decisionHash, council.contractId, contract.version, contract.content_hash.trim(), JSON.stringify(request.substance), contentHash],
    );
    await client.query(
      `INSERT INTO department_plan_revisions (revision_id, council_id, department_id, version, substance, content_hash, reason, affected_item_ids, actor_id, session_ref)
       VALUES ($1, $2, $3, 1, $4::jsonb, $5, $6, $7::jsonb, $8, $9)`,
      [randomUUID(), request.councilId, request.departmentId, JSON.stringify(request.substance), contentHash, "initial plan", JSON.stringify(request.substance.items.map((item) => item.itemId)), context.actorId, context.sessionRef],
    );
    await client.query("COMMIT"); open = false;
    return mapPlan(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function readDepartmentPlan(pool: Pool, councilId: string, departmentId: string): Promise<DepartmentPlan> {
  const result = await pool.query<DepartmentPlanRow>(planSelectSql() + " WHERE council_id = $1 AND department_id = $2", [councilId, departmentId]);
  if (result.rowCount !== 1) throw new DepartmentPlanNotFoundError(`Department Plan not found: ${councilId}/${departmentId}`);
  const row = result.rows[0]!;
  let substance: DepartmentPlanSubstance;
  try {
    assertValidDepartmentPlanSubstance(row.substance);
    substance = row.substance;
  } catch {
    throw new DepartmentPlanError("Stored Department Plan substance is invalid");
  }
  const expectedHash = departmentPlanSubstanceContentHash(substance);
  if (row.content_hash.trim() !== expectedHash) throw new DepartmentPlanError("Stored Department Plan content hash is invalid");
  const council = await readHeadCouncil(pool, councilId);
  if (council.goalId !== row.goal_id || council.snapshot.projectId !== row.project_id || council.snapshotHash !== row.council_snapshot_hash.trim()) {
    throw new DepartmentPlanError("Stored Department Plan Council binding is invalid");
  }
  if (council.decisionPacket === null || decisionPacketContentHash(council.decisionPacket) !== row.decision_packet_hash.trim()) {
    throw new DepartmentPlanError("Stored Department Plan decision binding is invalid");
  }
  return mapPlan({ ...row, substance });
}

export async function listDepartmentPlansForCouncil(pool: Pool, councilId: string): Promise<readonly DepartmentPlan[]> {
  const result = await pool.query<{ department_id: string }>("SELECT department_id FROM department_plans WHERE council_id = $1 ORDER BY department_id", [councilId]);
  return Promise.all(result.rows.map((row) => readDepartmentPlan(pool, councilId, row.department_id)));
}

/** Append-only version increment with an optimistic expected-version check; the Council/Contract binding never changes. */
export async function reviseDepartmentPlan(
  pool: Pool,
  councilId: string,
  departmentId: string,
  expectedVersion: number,
  newSubstance: DepartmentPlanSubstance,
  reason: string,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
): Promise<DepartmentPlan> {
  assertValidDepartmentPlanSubstance(newSubstance);
  if (reason.trim() === "") throw new DepartmentPlanError("A Department Plan revision requires a nonblank reason");
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const current = await client.query<DepartmentPlanRow>(planSelectSql() + " WHERE council_id = $1 AND department_id = $2 FOR UPDATE", [councilId, departmentId]);
    if (current.rowCount !== 1) throw new DepartmentPlanNotFoundError(`Department Plan not found: ${councilId}/${departmentId}`);
    const plan = current.rows[0]!;
    const council = await readHeadCouncil(pool, councilId);
    assertGoalProofOrThrow(council.goalId, proof);
    await lockGoalLease(client, proof);
    await assertAuthorizedPlanOwner(client, council, departmentId, context);
    const contentHash = departmentPlanSubstanceContentHash(newSubstance);
    if (plan.current_version === expectedVersion && plan.content_hash.trim() === contentHash) { await client.query("COMMIT"); open = false; return mapPlan(plan); }
    if (plan.current_version === expectedVersion + 1) {
      // A retry whose response was lost: the revision this call would have
      // produced may already be the current version. Compare against the
      // durable revision history, not just current content, since current
      // content could coincidentally differ for an unrelated reason.
      const priorRevision = await client.query<{ content_hash: string }>(
        "SELECT content_hash FROM department_plan_revisions WHERE council_id = $1 AND department_id = $2 AND version = $3",
        [councilId, departmentId, plan.current_version],
      );
      if (priorRevision.rowCount === 1 && priorRevision.rows[0]!.content_hash.trim() === contentHash) { await client.query("COMMIT"); open = false; return mapPlan(plan); }
    }
    if (plan.current_version !== expectedVersion) throw new DepartmentPlanError(`Department Plan version conflict: expected ${expectedVersion}, current is ${plan.current_version}`);
    const nextVersion = plan.current_version + 1;
    const previousItems = new Set((plan.substance.items ?? []).map((item) => item.itemId));
    const nextItems = new Set(newSubstance.items.map((item) => item.itemId));
    const affected = [...new Set([...previousItems, ...nextItems])].filter((id) => !previousItems.has(id) || !nextItems.has(id) || canonicalJson(plan.substance.items.find((item) => item.itemId === id)) !== canonicalJson(newSubstance.items.find((item) => item.itemId === id)));
    const updated = await client.query<DepartmentPlanRow>(
      `UPDATE department_plans SET current_version = $3, substance = $4::jsonb, content_hash = $5, updated_at = transaction_timestamp()
       WHERE council_id = $1 AND department_id = $2
       RETURNING council_id, department_id, project_id, goal_id, head_role_id, council_snapshot_hash, decision_packet_hash, contract_id, contract_version, contract_content_hash, current_version, substance, content_hash`,
      [councilId, departmentId, nextVersion, JSON.stringify(newSubstance), contentHash],
    );
    await client.query(
      `INSERT INTO department_plan_revisions (revision_id, council_id, department_id, version, substance, content_hash, reason, affected_item_ids, actor_id, session_ref)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10)`,
      [randomUUID(), councilId, departmentId, nextVersion, JSON.stringify(newSubstance), contentHash, reason.trim(), JSON.stringify(affected), context.actorId, context.sessionRef],
    );
    await client.query("COMMIT"); open = false;
    return mapPlan(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
