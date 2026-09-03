import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  assertValidDeviceCommandResult,
  assertValidDeviceGrantScope,
  deviceGrantRequiresCeoApproval,
  isTerminalGoalState,
  type DeviceGrant,
  type DeviceGrantScope,
  type DeviceGrantState,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, type CouncilActorContext } from "./council.js";

export class DeviceGrantError extends Error {
  constructor(message: string) { super(message); this.name = "DeviceGrantError"; }
}
export class DeviceGrantNotFoundError extends DeviceGrantError {}
export class DeviceGrantAuthorizationError extends DeviceGrantError {}
export class DeviceGrantRevokedError extends DeviceGrantError {}
export class DeviceGrantExpiredError extends DeviceGrantError {}

interface GrantRow {
  grant_id: string;
  goal_id: string;
  device_id: string;
  action_types: string[];
  project_paths: string[];
  applications: string[];
  data_scope: string[];
  network_scope: string[];
  ceo_approved: boolean;
  issued_by: string;
  issued_at: Date;
  expires_at: Date;
  state: DeviceGrantState;
  revoked_at: Date | null;
  highest_sequence: number;
}

function mapGrant(row: GrantRow): DeviceGrant {
  return {
    grantId: row.grant_id,
    goalId: row.goal_id,
    deviceId: row.device_id,
    scope: {
      actionTypes: row.action_types,
      projectPaths: row.project_paths,
      applications: row.applications,
      dataScope: row.data_scope,
      networkScope: row.network_scope,
    },
    ceoApproved: row.ceo_approved,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    state: row.state,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

const GRANT_COLUMNS = "grant_id, goal_id, device_id, action_types, project_paths, applications, data_scope, network_scope, ceo_approved, issued_by, issued_at, expires_at, state, revoked_at, highest_sequence";

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query(
    "SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE",
    [proof.goalId, proof.ownerId, proof.fencingToken],
  );
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 23))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

/**
 * Issue a Goal-scoped device grant. Requires the current Goal lease and an
 * open control latch, and the target device must be enrolled and not
 * revoked. A scope naming a critical action family requires explicit CEO
 * approval. The returned `capabilityToken` is the only time the plaintext
 * value ever exists outside the caller; only its SHA-256 hash is durable.
 */
export async function createDeviceGrant(
  pool: Pool,
  goalId: string,
  deviceId: string,
  scope: DeviceGrantScope,
  expiresAt: string,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
  ceoApproved = false,
): Promise<{ grant: DeviceGrant; capabilityToken: string }> {
  assertValidDeviceGrantScope(scope);
  if (goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) {
    throw new StaleGoalLeaseError(proof.goalId);
  }
  if (deviceGrantRequiresCeoApproval(scope) && !ceoApproved) {
    throw new DeviceGrantAuthorizationError("A device grant naming a critical action family requires explicit CEO approval");
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) throw new DeviceGrantError("Device grant expiresAt must be an ISO date");
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await lockGoalLease(client, proof);
    if (expiresAtMs <= Date.now()) throw new DeviceGrantError("Device grant expiresAt must be in the future");
    const device = await client.query<{ state: string }>("SELECT state FROM devices WHERE device_id = $1 FOR KEY SHARE", [deviceId]);
    if (device.rowCount !== 1) throw new DeviceGrantError(`Device not found: ${deviceId}`);
    if (device.rows[0]!.state === "revoked") throw new DeviceGrantRevokedError(`Device is revoked: ${deviceId}`);
    const capabilityToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(capabilityToken, "utf8").digest("hex");
    const inserted = await client.query<GrantRow>(
      `INSERT INTO device_grants
         (grant_id, goal_id, device_id, action_types, project_paths, applications, data_scope, network_scope,
          ceo_approved, capability_token_hash, issued_by, expires_at, state)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, 'active')
       RETURNING ${GRANT_COLUMNS}`,
      [
        randomUUID(), goalId, deviceId,
        JSON.stringify(scope.actionTypes), JSON.stringify(scope.projectPaths), JSON.stringify(scope.applications),
        JSON.stringify(scope.dataScope), JSON.stringify(scope.networkScope),
        ceoApproved, tokenHash, context.actorId, expiresAt,
      ],
    );
    await client.query("COMMIT");
    open = false;
    return { grant: mapGrant(inserted.rows[0]!), capabilityToken };
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readDeviceGrant(pool: Pick<Pool, "query">, grantId: string): Promise<DeviceGrant | undefined> {
  const result = await pool.query<GrantRow>(`SELECT ${GRANT_COLUMNS} FROM device_grants WHERE grant_id = $1`, [grantId]);
  return result.rowCount === 1 ? mapGrant(result.rows[0]!) : undefined;
}

export async function listDeviceGrantsForGoal(pool: Pick<Pool, "query">, goalId: string): Promise<readonly DeviceGrant[]> {
  const result = await pool.query<GrantRow>(`SELECT ${GRANT_COLUMNS} FROM device_grants WHERE goal_id = $1 ORDER BY issued_at, grant_id`, [goalId]);
  return result.rows.map(mapGrant);
}

/** Revocation is immediate, one-way, and CEO-authorized. Retrying an
 * already-revoked grant is idempotent. */
export async function revokeDeviceGrant(pool: Pool, grantId: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<DeviceGrant> {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const current = await client.query<GrantRow>(`SELECT ${GRANT_COLUMNS} FROM device_grants WHERE grant_id = $1 FOR UPDATE`, [grantId]);
    if (current.rowCount !== 1) throw new DeviceGrantNotFoundError(`Device grant not found: ${grantId}`);
    const grant = current.rows[0]!;
    if (grant.goal_id !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) {
      throw new StaleGoalLeaseError(proof.goalId);
    }
    await lockGoalLease(client, proof);
    if (grant.state === "revoked") {
      await client.query("COMMIT");
      open = false;
      return mapGrant(grant);
    }
    const updated = await client.query<GrantRow>(
      `UPDATE device_grants SET state = 'revoked', revoked_at = transaction_timestamp() WHERE grant_id = $1 RETURNING ${GRANT_COLUMNS}`,
      [grantId],
    );
    await client.query("COMMIT");
    open = false;
    return mapGrant(updated.rows[0]!);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface DeviceCommandResultInput {
  readonly commandId: string;
  readonly action: string;
  readonly target: string;
  readonly sequence: number;
  readonly resultSummary: string;
  readonly executedAt: string;
}

export interface DeviceCommandResultRecord extends DeviceCommandResultInput {
  readonly resultId: string;
  readonly grantId: string;
  readonly recordedAt: string;
}

interface ResultRow {
  result_id: string;
  grant_id: string;
  command_id: string;
  action: string;
  target: string;
  sequence: number;
  result_summary: string;
  executed_at: Date;
  recorded_at: Date;
}

function mapResult(row: ResultRow): DeviceCommandResultRecord {
  return {
    resultId: row.result_id,
    grantId: row.grant_id,
    commandId: row.command_id,
    action: row.action,
    target: row.target,
    sequence: row.sequence,
    resultSummary: row.result_summary,
    executedAt: row.executed_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
  };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/**
 * Record one authenticated, sequenced device command result against a live
 * grant. The submitted capability token is verified against the durable
 * hash (never stored or compared as plaintext); the action and target must
 * fall inside the grant's own scope; the Goal must not be terminal; the
 * grant must not be expired or revoked; and the fencing sequence must be
 * strictly greater than every sequence already accepted for this grant, so
 * a result that arrives after a successor is rejected, not silently kept.
 */
export async function recordDeviceCommandResult(
  pool: Pool,
  grantId: string,
  capabilityToken: string,
  input: DeviceCommandResultInput,
): Promise<DeviceCommandResultRecord> {
  assertValidDeviceCommandResult({ ...input, grantId });
  if (typeof capabilityToken !== "string" || !/^[0-9a-f]{64}$/.test(capabilityToken)) {
    throw new DeviceGrantAuthorizationError("Device capability token is malformed");
  }
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 29))", [grantId]);
    const grantResult = await client.query<GrantRow>(`SELECT ${GRANT_COLUMNS} FROM device_grants WHERE grant_id = $1 FOR UPDATE`, [grantId]);
    if (grantResult.rowCount !== 1) throw new DeviceGrantNotFoundError(`Device grant not found: ${grantId}`);
    const grant = grantResult.rows[0]!;
    const tokenHash = createHash("sha256").update(capabilityToken, "utf8").digest("hex");
    const grantRow = await client.query<{ capability_token_hash: string }>("SELECT capability_token_hash FROM device_grants WHERE grant_id = $1", [grantId]);
    if (!timingSafeEqualHex(tokenHash, grantRow.rows[0]!.capability_token_hash)) {
      throw new DeviceGrantAuthorizationError("Device capability token does not match this grant");
    }
    if (grant.state === "revoked") throw new DeviceGrantRevokedError(`Device grant is revoked: ${grantId}`);
    if (grant.state === "closed") throw new DeviceGrantExpiredError(`Device grant is closed: ${grantId}`);
    if (Date.parse(grant.expires_at.toISOString()) <= Date.now()) throw new DeviceGrantExpiredError(`Device grant has expired: ${grantId}`);
    const goalResult = await client.query<{ state: string }>("SELECT state FROM goals WHERE goal_id = $1", [grant.goal_id]);
    if (goalResult.rowCount !== 1 || isTerminalGoalState(goalResult.rows[0]!.state as never)) {
      throw new DeviceGrantExpiredError(`Device grant's Goal is closed: ${grant.goal_id}`);
    }
    // A paused/stopping Goal must halt device command execution the same
    // way it halts every other write path in this codebase (Department
    // Plans, Mission Bundles, budget). A grant is not a bypass of the
    // pause/stop control latch.
    await assertGoalControlOpen(client, grant.goal_id);
    if (!grant.action_types.includes(input.action)) throw new DeviceGrantAuthorizationError(`Action is outside the device grant scope: ${input.action}`);
    if (!grant.project_paths.some((allowed) => input.target === allowed || input.target.startsWith(`${allowed}/`))) {
      throw new DeviceGrantAuthorizationError(`Target is outside the device grant scope: ${input.target}`);
    }
    if (input.sequence <= grant.highest_sequence) {
      throw new DeviceGrantError(`Device command sequence ${input.sequence} does not exceed the grant's fencing sequence ${grant.highest_sequence}`);
    }
    const inserted = await client.query<ResultRow>(
      `INSERT INTO device_command_results (result_id, grant_id, command_id, action, target, sequence, result_summary, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING result_id, grant_id, command_id, action, target, sequence, result_summary, executed_at, recorded_at`,
      [randomUUID(), grantId, input.commandId, input.action, input.target, input.sequence, input.resultSummary, input.executedAt],
    );
    await client.query("UPDATE device_grants SET highest_sequence = $2 WHERE grant_id = $1", [grantId, input.sequence]);
    await client.query("COMMIT");
    open = false;
    return mapResult(inserted.rows[0]!);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listDeviceCommandResults(pool: Pick<Pool, "query">, grantId: string): Promise<readonly DeviceCommandResultRecord[]> {
  const result = await pool.query<ResultRow>(
    "SELECT result_id, grant_id, command_id, action, target, sequence, result_summary, executed_at, recorded_at FROM device_command_results WHERE grant_id = $1 ORDER BY sequence",
    [grantId],
  );
  return result.rows.map(mapResult);
}
