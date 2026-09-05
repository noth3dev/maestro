import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  assertValidDeviceCommandResult, evaluateLocalDevicePolicy, isTerminalGoalState, type DeviceEnrollment, type DeviceGrantEnvelope, type DeviceGrantScope,
  type LocalDevicePolicy, type DeviceGrantState,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { assertGoalControlOpen } from "./council.js";
import { DeviceGrantAuthorizationError, DeviceGrantError, DeviceGrantExpiredError, DeviceGrantRevokedError } from "./device-grant.js";

interface GrantRuntimeRow {
  grant_id: string; goal_id: string; device_id: string; action_types: string[]; project_paths: string[]; applications: string[]; data_scope: string[]; network_scope: string[];
  issued_at: Date; expires_at: Date; state: DeviceGrantState; capability_token_hash: string; highest_sequence: number;
}
interface DeviceRuntimeRow { device_id: string; display_name: string; device_type: "computer" | "cli_endpoint"; public_key: string; identity_fingerprint: string; enrolled_by: string; enrolled_at: Date; state: "enrolled" | "revoked"; revoked_at: Date | null; }
interface PolicyRuntimeRow { device_id: string; policy_version: number; rules: LocalDevicePolicy["rules"]; expires_at: Date | null; }

export interface DeviceAgentAuthorization {
  readonly enrollment: DeviceEnrollment;
  readonly policy: LocalDevicePolicy;
  readonly scope: DeviceGrantScope;
  readonly goalId: string; readonly projectId: string; readonly grantId: string; readonly deviceId: string;
}

export interface DeviceAgentCommandInput {
  readonly envelope: DeviceGrantEnvelope;
  readonly capabilityToken: string;
  readonly sessionId: string;
}

function sameHash(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "hex"); const b = Buffer.from(expected.trim(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
function scope(row: GrantRuntimeRow): DeviceGrantScope { return { actionTypes: row.action_types, projectPaths: row.project_paths, applications: row.applications, dataScope: row.data_scope, networkScope: row.network_scope }; }
function enrollment(row: DeviceRuntimeRow): DeviceEnrollment {
  return { deviceId: row.device_id, displayName: row.display_name, deviceType: row.device_type, publicKey: row.public_key, identityFingerprint: row.identity_fingerprint.trim(), enrolledBy: row.enrolled_by, enrolledAt: row.enrolled_at.toISOString(), state: row.state, revokedAt: row.revoked_at?.toISOString() ?? null };
}
function policy(row: PolicyRuntimeRow): LocalDevicePolicy { return { deviceId: row.device_id, policyVersion: row.policy_version, rules: row.rules, expiresAt: row.expires_at?.toISOString() ?? null }; }
function tokenHash(token: string): string {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new DeviceGrantAuthorizationError("Device capability token is malformed");
  return createHash("sha256").update(token, "utf8").digest("hex");
}
async function loadRuntime(client: PoolClient, input: DeviceAgentCommandInput, lockGrant: boolean): Promise<{ grant: GrantRuntimeRow; device: DeviceRuntimeRow; policy: PolicyRuntimeRow; goalProjectId: string; goalState: string; }> {
  const grantResult = await client.query<GrantRuntimeRow>(`SELECT grant_id, goal_id, device_id, action_types, project_paths, applications, data_scope, network_scope, issued_at, expires_at, state, capability_token_hash, highest_sequence FROM device_grants WHERE grant_id = $1${lockGrant ? " FOR UPDATE" : ""}`, [input.envelope.grantId]);
  if (grantResult.rowCount !== 1) throw new DeviceGrantAuthorizationError("Device grant is not found");
  const grant = grantResult.rows[0]!;
  if (!sameHash(tokenHash(input.capabilityToken), grant.capability_token_hash)) throw new DeviceGrantAuthorizationError("Device capability token does not match this grant");
  const deviceResult = await client.query<DeviceRuntimeRow>("SELECT device_id, display_name, device_type, public_key, identity_fingerprint, enrolled_by, enrolled_at, state, revoked_at FROM devices WHERE device_id = $1 FOR KEY SHARE", [grant.device_id]);
  if (deviceResult.rowCount !== 1) throw new DeviceGrantAuthorizationError("Device enrollment is not found");
  const device = deviceResult.rows[0]!;
  const goal = await client.query<{ project_id: string; state: string }>("SELECT project_id, state FROM goals WHERE goal_id = $1", [grant.goal_id]);
  if (goal.rowCount !== 1) throw new DeviceGrantExpiredError("Device grant Goal is not found");
  const latestPolicy = await client.query<PolicyRuntimeRow>("SELECT device_id, policy_version, rules, expires_at FROM device_policies WHERE device_id = $1 ORDER BY policy_version DESC LIMIT 1", [grant.device_id]);
  if (latestPolicy.rowCount !== 1) throw new DeviceGrantAuthorizationError("Device has no local policy");
  return { grant, device, policy: latestPolicy.rows[0]!, goalProjectId: goal.rows[0]!.project_id, goalState: goal.rows[0]!.state };
}
function checkEnvelopeMatches(envelope: DeviceGrantEnvelope, runtime: Awaited<ReturnType<typeof loadRuntime>>): void {
  if (runtime.grant.goal_id !== envelope.goalId || runtime.goalProjectId !== envelope.projectId || runtime.grant.device_id !== envelope.deviceId) throw new DeviceGrantAuthorizationError("Device command identity does not match its durable grant");
}
function checkScope(envelope: DeviceGrantEnvelope, runtime: Awaited<ReturnType<typeof loadRuntime>>): void {
  const current = scope(runtime.grant);
  if (!current.actionTypes.includes(envelope.action)) throw new DeviceGrantAuthorizationError("Action is outside the device grant scope");
  if (!current.projectPaths.some((allowed) => envelope.target === allowed || envelope.target.startsWith(`${allowed.replace(/\/$/, "")}/`))) throw new DeviceGrantAuthorizationError("Target is outside the device grant scope");
  if (!current.projectPaths.includes(envelope.projectPath)) throw new DeviceGrantAuthorizationError("Project path is outside the device grant scope");
  if (!current.applications.includes(envelope.application)) throw new DeviceGrantAuthorizationError("Application is outside the device grant scope");
  if (!current.dataScope.includes(envelope.dataResource)) throw new DeviceGrantAuthorizationError("Data scope is outside the device grant scope");
  if (!current.networkScope.includes(envelope.networkTarget)) throw new DeviceGrantAuthorizationError("Network scope is outside the device grant scope");
  if (runtime.policy.policy_version !== envelope.policyVersion) throw new DeviceGrantAuthorizationError("Device policy version is stale");
  const local = evaluateLocalDevicePolicy(enrollment(runtime.device), policy(runtime.policy), { deviceId: envelope.deviceId, identityFingerprint: runtime.device.identity_fingerprint.trim(), action: envelope.action, target: envelope.target });
  if (!local.allowed) throw new DeviceGrantAuthorizationError(`Device local policy denied: ${local.reason}`);
}
function checkLive(runtime: Awaited<ReturnType<typeof loadRuntime>>, envelope: DeviceGrantEnvelope): void {
  if (runtime.device.state === "revoked") throw new DeviceGrantRevokedError(`Device is revoked: ${runtime.device.device_id}`);
  if (runtime.grant.state === "revoked") throw new DeviceGrantRevokedError(`Device grant is revoked: ${runtime.grant.grant_id}`);
  if (runtime.grant.state === "closed" || runtime.grant.state === "expired" || runtime.grant.expires_at.getTime() <= Date.now()) throw new DeviceGrantExpiredError(`Device grant is not active: ${runtime.grant.grant_id}`);
  if (isTerminalGoalState(runtime.goalState as never)) throw new DeviceGrantExpiredError("Device grant Goal is closed");
  if (Date.parse(envelope.expiresAt) <= Date.now()) throw new DeviceGrantExpiredError("Device command envelope is expired");
}

/** Read-only durable lookup used to prepare local validation; no command is claimed here. */
export async function loadDeviceAgentAuthorization(pool: Pool, input: DeviceAgentCommandInput): Promise<DeviceAgentAuthorization> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const runtime = await loadRuntime(client, input, false);
    checkEnvelopeMatches(input.envelope, runtime); checkLive(runtime, input.envelope);
    const session = await client.query("SELECT 1 FROM device_agent_sessions WHERE session_id = $1 AND device_id = $2 AND identity_fingerprint = $3 AND state = 'active'", [input.sessionId, runtime.device.device_id, runtime.device.identity_fingerprint]);
    if (session.rowCount !== 1) throw new DeviceGrantAuthorizationError("Device agent session is not active");
    return { enrollment: enrollment(runtime.device), policy: policy(runtime.policy), scope: scope(runtime.grant), goalId: runtime.grant.goal_id, projectId: runtime.goalProjectId, grantId: runtime.grant.grant_id, deviceId: runtime.device.device_id };
  }
  finally { if (open) await client.query("ROLLBACK"); client.release(); }
}

/** Atomically rechecks authority and claims a command sequence before an OS effect. */
export async function claimDeviceAgentCommand(pool: Pool, input: DeviceAgentCommandInput): Promise<void> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true; await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 29))", [input.envelope.grantId]);
    const session = await client.query<{ identity_fingerprint: string }>("SELECT s.identity_fingerprint FROM device_agent_sessions s JOIN devices d ON d.device_id = s.device_id WHERE s.session_id = $1 AND s.device_id = $2 AND s.identity_fingerprint = d.identity_fingerprint AND d.state = 'enrolled' AND s.state = 'active' FOR UPDATE OF s", [input.sessionId, input.envelope.deviceId]);
    if (session.rowCount !== 1) throw new DeviceGrantAuthorizationError("Device agent session is not active");
    const runtime = await loadRuntime(client, input, true); checkEnvelopeMatches(input.envelope, runtime); checkLive(runtime, input.envelope);
    const lease = await client.query<{ fencing_token: string }>("SELECT fencing_token FROM goal_leases WHERE goal_id = $1 AND expires_at > clock_timestamp() FOR SHARE", [runtime.grant.goal_id]);
    if (lease.rowCount !== 1 || lease.rows[0]!.fencing_token !== input.envelope.goalFencingToken) throw new DeviceGrantAuthorizationError("Device command Goal fence is stale");
    await assertGoalControlOpen(client, runtime.grant.goal_id); checkScope(input.envelope, runtime);
    const unresolved = await client.query("SELECT 1 FROM device_command_claims WHERE grant_id = $1 AND state = 'unknown' LIMIT 1", [input.envelope.grantId]);
    if (unresolved.rowCount !== 0) throw new DeviceGrantError("Device grant has an unresolved command outcome and is blocked");
    if (BigInt(input.envelope.goalFencingToken) <= 0n) throw new DeviceGrantAuthorizationError("Goal fencing token is invalid");
    if (input.envelope.sequence <= runtime.grant.highest_sequence) throw new DeviceGrantError("Device command sequence is stale or replayed");
    const existing = await client.query<{ state: string; grant_id: string; sequence: number }>("SELECT state, grant_id, sequence FROM device_command_claims WHERE command_id = $1", [input.envelope.commandId]);
    if (existing.rowCount !== 0) throw new DeviceGrantError("Device command identity was already claimed");
    await client.query(`INSERT INTO device_command_claims (command_id, grant_id, session_id, goal_id, project_id, device_id, action, target, application, data_resource, network_target, policy_version, goal_fencing_token, sequence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::bigint, $14)`, [input.envelope.commandId, input.envelope.grantId, input.sessionId, input.envelope.goalId, input.envelope.projectId, input.envelope.deviceId, input.envelope.action, input.envelope.target, input.envelope.application, input.envelope.dataResource, input.envelope.networkTarget, input.envelope.policyVersion, input.envelope.goalFencingToken, input.envelope.sequence]);
    await client.query("UPDATE device_grants SET highest_sequence = $2 WHERE grant_id = $1 AND highest_sequence < $2", [input.envelope.grantId, input.envelope.sequence]);
    await client.query("COMMIT"); open = false;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/**
 * A process crash can occur after a pre-effect claim commits but before the
 * external effect and result are durably paired. On the next startup, mark
 * every unresolved claim for this device unknown and block its grant; never
 * guess whether the OS effect happened.
 */
export async function markUnresolvedDeviceAgentCommandsUnknown(pool: Pool, deviceId: string, reason = "device-agent restart left command outcome unknown"): Promise<number> {
  if (deviceId.trim() === "" || reason.trim() === "") throw new DeviceGrantError("Device recovery requires a deviceId and reason");
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 43))", [`device-agent:${deviceId}`]);
    const result = await client.query(
      `UPDATE device_command_claims SET state = 'unknown', unknown_at = clock_timestamp(), recovery_reason = $2
        WHERE device_id = $1 AND state = 'claimed'`, [deviceId, reason.trim()],
    );
    await client.query("COMMIT"); open = false; return result.rowCount ?? 0;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function completeDeviceAgentCommand(pool: Pool, input: DeviceAgentCommandInput, resultSummary: string, executedAt: string): Promise<void> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true; await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 29))", [input.envelope.grantId]);
    const claim = await client.query<{ state: string; grant_id: string; session_id: string; sequence: number; action: string; target: string }>("SELECT state, grant_id, session_id, sequence, action, target FROM device_command_claims WHERE command_id = $1 FOR UPDATE", [input.envelope.commandId]);
    if (claim.rowCount !== 1 || claim.rows[0]!.grant_id !== input.envelope.grantId || claim.rows[0]!.session_id !== input.sessionId || claim.rows[0]!.sequence !== input.envelope.sequence || claim.rows[0]!.action !== input.envelope.action || claim.rows[0]!.target !== input.envelope.target || claim.rows[0]!.state !== "claimed") throw new DeviceGrantError("Device command claim is missing or mismatched");
    const token = await client.query("SELECT 1 FROM device_grants WHERE grant_id = $1 AND capability_token_hash = $2", [input.envelope.grantId, tokenHash(input.capabilityToken)]);
    if (token.rowCount !== 1) throw new DeviceGrantAuthorizationError("Device capability token does not match this grant");
    const result = { commandId: input.envelope.commandId, grantId: input.envelope.grantId, action: input.envelope.action, target: input.envelope.target, sequence: input.envelope.sequence, resultSummary, executedAt };
    assertValidDeviceCommandResult(result);
    await client.query(`INSERT INTO device_command_results (result_id, grant_id, command_id, action, target, sequence, result_summary, executed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [randomUUID(), input.envelope.grantId, input.envelope.commandId, input.envelope.action, input.envelope.target, input.envelope.sequence, resultSummary, executedAt]);
    await client.query("UPDATE device_command_claims SET state = 'completed', completed_at = transaction_timestamp() WHERE command_id = $1", [input.envelope.commandId]);
    await client.query("COMMIT"); open = false;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
