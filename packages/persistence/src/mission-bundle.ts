import { randomUUID } from "node:crypto";
import {
  assertValidMissionBundleSubstance,
  assertValidMissionPersonaOverlay,
  deriveMissionPersonaOverlay,
  isMissionPersonaOverlayExpired,
  missionBundleSubstanceContentHash,
  PERSONA_AXES,
  type MissionBundle,
  type MissionBundleSubstance,
  type MissionPersonaOverlay,
  type MissionPersonaOverlayInputs,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "./council.js";
import { readDepartmentPlan } from "./department-plan.js";

export class MissionBundleError extends Error {}
export class MissionBundleNotFoundError extends MissionBundleError {}
export class MissionPersonaOverlayNotFoundError extends MissionBundleError {}
export class MissionPersonaOverlayExpiredError extends MissionBundleError {}

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

export interface IssueMissionPersonaOverlayRequest {
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly itemId: string;
  readonly inputs: MissionPersonaOverlayInputs;
  /** Explicit mission-lifetime bound: expiresAt = issuedAt + missionLifetimeMs. */
  readonly missionLifetimeMs: number;
}

interface MissionPersonaOverlayRow {
  council_id: string;
  department_id: string;
  plan_version: number;
  item_id: string;
  persona: unknown;
  issued_at: Date | string;
  expires_at: Date | string;
}

function mapPersonaOverlay(row: MissionPersonaOverlayRow): MissionPersonaOverlay {
  const overlay = {
    councilId: row.council_id,
    departmentId: row.department_id,
    planVersion: row.plan_version,
    itemId: row.item_id,
    persona: row.persona,
    issuedAt: new Date(row.issued_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
  assertValidMissionPersonaOverlay(overlay);
  return { ...overlay, persona: Object.freeze({ ...overlay.persona }) };
}

function personaOverlaySelectSql(): string {
  return "SELECT council_id, department_id, plan_version, item_id, persona, issued_at, expires_at FROM mission_persona_overlays";
}

/**
 * Derives and durably issues a Mission persona overlay for an existing
 * Mission Bundle (identified the same way as `readMissionBundle`).
 * Identical-content retry (same derived persona) is idempotent, matching
 * this file's existing Mission Bundle pattern; a differing retry for the
 * same bundle is a conflict.
 */
export async function issueMissionPersonaOverlay(pool: Pool, request: IssueMissionPersonaOverlayRequest): Promise<MissionPersonaOverlay> {
  if (!Number.isSafeInteger(request.missionLifetimeMs) || request.missionLifetimeMs <= 0) {
    throw new MissionBundleError("Mission persona overlay requires a positive whole-millisecond missionLifetimeMs");
  }
  const persona = deriveMissionPersonaOverlay(request.inputs);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const bundle = await client.query(
      "SELECT 1 FROM mission_bundles WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4 FOR UPDATE",
      [request.councilId, request.departmentId, request.planVersion, request.itemId],
    );
    if (bundle.rowCount !== 1) throw new MissionBundleNotFoundError(`Mission Bundle not found: ${request.councilId}/${request.departmentId}/${request.planVersion}/${request.itemId}`);
    const existing = await client.query<MissionPersonaOverlayRow>(
      personaOverlaySelectSql() + " WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4 FOR UPDATE",
      [request.councilId, request.departmentId, request.planVersion, request.itemId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      const prior = mapPersonaOverlay(existing.rows[0]!);
      if (isMissionPersonaOverlayExpired(prior, new Date())) {
        throw new MissionPersonaOverlayExpiredError(`Mission Persona Overlay expired: ${request.councilId}/${request.departmentId}/${request.planVersion}/${request.itemId}`);
      }
      // jsonb does not preserve key order, so compare axis-by-axis rather
      // than relying on JSON.stringify's insertion-order-dependent output.
      const samePersona = PERSONA_AXES.every((axis) => prior.persona[axis] === persona[axis]);
      if (samePersona) { await client.query("COMMIT"); open = false; return prior; }
      throw new MissionBundleError("A Mission Persona Overlay already exists for this bundle with different derived values");
    }
    const inserted = await client.query<MissionPersonaOverlayRow>(
      `INSERT INTO mission_persona_overlays (council_id, department_id, plan_version, item_id, persona, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, transaction_timestamp() + ($6::bigint * interval '1 millisecond'))
       RETURNING council_id, department_id, plan_version, item_id, persona, issued_at, expires_at`,
      [request.councilId, request.departmentId, request.planVersion, request.itemId, JSON.stringify(persona), request.missionLifetimeMs],
    );
    await client.query("COMMIT"); open = false;
    return mapPersonaOverlay(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function readStoredMissionPersonaOverlay(pool: Pool, councilId: string, departmentId: string, planVersion: number, itemId: string): Promise<MissionPersonaOverlay> {
  const result = await pool.query<MissionPersonaOverlayRow>(
    personaOverlaySelectSql() + " WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4",
    [councilId, departmentId, planVersion, itemId],
  );
  if (result.rowCount !== 1) throw new MissionPersonaOverlayNotFoundError(`Mission Persona Overlay not found: ${councilId}/${departmentId}/${planVersion}/${itemId}`);
  return mapPersonaOverlay(result.rows[0]!);
}

function assertMissionPersonaOverlayAvailable(
  overlay: MissionPersonaOverlay,
  councilId: string,
  departmentId: string,
  planVersion: number,
  itemId: string,
  now: Date,
): MissionPersonaOverlay {
  if (isMissionPersonaOverlayExpired(overlay, now)) {
    throw new MissionPersonaOverlayExpiredError(`Mission Persona Overlay expired: ${councilId}/${departmentId}/${planVersion}/${itemId}`);
  }
  return overlay;
}

/** Reads the overlay only while its explicit mission-lifetime expiry is active. */
export async function readMissionPersonaOverlay(
  pool: Pool,
  councilId: string,
  departmentId: string,
  planVersion: number,
  itemId: string,
  now: Date = new Date(),
): Promise<MissionPersonaOverlay> {
  return assertMissionPersonaOverlayAvailable(
    await readStoredMissionPersonaOverlay(pool, councilId, departmentId, planVersion, itemId),
    councilId, departmentId, planVersion, itemId, now,
  );
}

/** Explicit alias for callers that want to state the active-lifetime requirement. */
export async function readActiveMissionPersonaOverlay(
  pool: Pool,
  councilId: string,
  departmentId: string,
  planVersion: number,
  itemId: string,
  now: Date = new Date(),
): Promise<MissionPersonaOverlay> {
  return readMissionPersonaOverlay(pool, councilId, departmentId, planVersion, itemId, now);
}
