import { randomUUID } from "node:crypto";
import {
  assertValidMissionBundleSubstance,
  missionBundleSubstanceContentHash,
  type MissionBundle,
  type MissionBundleSubstance,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "./council.js";
import { readDepartmentPlan } from "./department-plan.js";

export class MissionBundleError extends Error {}
export class MissionBundleNotFoundError extends MissionBundleError {}

export interface CreateMissionBundleRequest {
  readonly councilId: string;
  readonly departmentId: string;
  readonly itemId: string;
  readonly substance: MissionBundleSubstance;
}

interface MissionBundleRow {
  bundle_id: string;
  council_id: string;
  department_id: string;
  plan_version: number;
  plan_content_hash: string;
  item_id: string;
  parent_ref: string;
  substance: MissionBundleSubstance;
  content_hash: string;
}

function mapBundle(row: MissionBundleRow): MissionBundle {
  return {
    councilId: row.council_id,
    departmentId: row.department_id,
    planVersion: row.plan_version,
    planContentHash: row.plan_content_hash.trim(),
    itemId: row.item_id,
    parentRef: row.parent_ref,
    substance: row.substance,
    contentHash: row.content_hash.trim(),
  };
}

function bundleSelectSql(): string {
  return "SELECT bundle_id, council_id, department_id, plan_version, plan_content_hash, item_id, parent_ref, substance, content_hash FROM mission_bundles";
}

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 15))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

/**
 * Issue a Mission Bundle binding one Scout/Execution mission to exactly one
 * item of the Department's currently active Plan. Only the Department's
 * currently active, captured Head may issue bundles for it -- the same
 * authorization strength as Department Plan creation, not mere Goal-lease
 * possession. Identical-content retry is idempotent; a differing retry
 * under the same (plan version, item) identity is a conflict.
 */
export async function createMissionBundle(pool: Pool, request: CreateMissionBundleRequest, proof: GoalLeaseProof, context: CouncilActorContext): Promise<MissionBundle> {
  assertValidMissionBundleSubstance(request.substance);
  if (request.substance.role === "head") throw new MissionBundleError("A Mission Bundle issues a Scout or Execution mission, not a Head");
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const council = await readHeadCouncil(pool, request.councilId);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const plan = await readDepartmentPlan(pool, request.councilId, request.departmentId);
    const item = plan.substance.items.find((candidate) => candidate.itemId === request.itemId);
    if (item === undefined) throw new MissionBundleError(`Department Plan has no item: ${request.itemId}`);
    if (item.kind !== request.substance.role) throw new MissionBundleError(`Mission bundle role ${request.substance.role} does not match plan item kind ${item.kind}`);
    const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === request.departmentId);
    if (captured === undefined) throw new MissionBundleError("Department is not a captured Council participant");
    const authorized = captured.headRoleId !== undefined
      ? isAuthorizedHeadCouncilActor(context, captured)
      : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
    if (!authorized) throw new MissionBundleError("Mission bundle issuer is not bound to the captured Head identity and session");
    const active = await client.query(
      "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3 FOR UPDATE",
      [council.goalId, request.departmentId, captured.sessionRef],
    );
    if (active.rowCount !== 1) throw new MissionBundleError("Captured Head session is no longer authorized to issue Mission Bundles");
    const contentHash = missionBundleSubstanceContentHash(request.substance);
    const existing = await client.query<MissionBundleRow>(
      bundleSelectSql() + " WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4 FOR UPDATE",
      [request.councilId, request.departmentId, plan.version, request.itemId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      const prior = existing.rows[0]!;
      if (prior.content_hash.trim() === contentHash) { await client.query("COMMIT"); open = false; return mapBundle(prior); }
      throw new MissionBundleError("A Mission Bundle already exists for this Department Plan item at this version");
    }
    const parentRef = `head:${request.departmentId}:${council.councilId}`;
    const inserted = await client.query<MissionBundleRow>(
      `INSERT INTO mission_bundles (bundle_id, council_id, department_id, plan_version, plan_content_hash, item_id, parent_ref, substance, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       RETURNING bundle_id, council_id, department_id, plan_version, plan_content_hash, item_id, parent_ref, substance, content_hash`,
      [randomUUID(), request.councilId, request.departmentId, plan.version, plan.contentHash, request.itemId, parentRef, JSON.stringify(request.substance), contentHash],
    );
    await client.query("COMMIT"); open = false;
    return mapBundle(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function readMissionBundle(pool: Pool, councilId: string, departmentId: string, planVersion: number, itemId: string): Promise<MissionBundle> {
  const result = await pool.query<MissionBundleRow>(bundleSelectSql() + " WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4", [councilId, departmentId, planVersion, itemId]);
  if (result.rowCount !== 1) throw new MissionBundleNotFoundError(`Mission Bundle not found: ${councilId}/${departmentId}/${planVersion}/${itemId}`);
  return mapBundle(result.rows[0]!);
}

export async function listMissionBundlesForPlan(pool: Pool, councilId: string, departmentId: string, planVersion: number): Promise<readonly MissionBundle[]> {
  const result = await pool.query<MissionBundleRow>(bundleSelectSql() + " WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 ORDER BY item_id", [councilId, departmentId, planVersion]);
  return result.rows.map(mapBundle);
}
