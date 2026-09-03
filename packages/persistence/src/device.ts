import { randomUUID } from "node:crypto";
import {
  assertValidDeviceEnrollment,
  assertValidDeviceInventory,
  InvalidDeviceInventoryError,
  assertValidLocalDevicePolicy,
  deviceIdentityFingerprint,
  LocalDevicePolicyAgent,
  type DeviceEnrollment,
  type DeviceEnrollmentState,
  type DeviceInventory,
  type DeviceRecord,
  type DeviceType,
  type LocalDeviceActionRequest,
  type LocalDevicePolicy,
  type LocalDevicePolicyInput,
  type LocalDevicePolicyDecision,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";

export type DeviceActorRole = "ceo" | "device_agent";

export interface DeviceActorContext {
  readonly actorId: string;
  readonly sessionRef: string;
  readonly role: DeviceActorRole;
  /** A device agent may mutate inventory only for its authenticated device subject. */
  readonly deviceId?: string;
  /** Device-agent authentication must match this durable enrollment fingerprint. */
  readonly identityFingerprint?: string;
}

export interface EnrollDeviceInput {
  readonly displayName: string;
  readonly deviceType: DeviceType;
  readonly publicKey: string;
}

export class DeviceError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "DeviceError"; }
}
export class DeviceAuthorizationError extends DeviceError {
  constructor(message: string) { super(message); this.name = "DeviceAuthorizationError"; }
}
export class DeviceNotFoundError extends DeviceError {
  constructor(message: string) { super(message); this.name = "DeviceNotFoundError"; }
}
export class DeviceRevokedError extends DeviceError {
  constructor(message: string) { super(message); this.name = "DeviceRevokedError"; }
}

interface StoredDeviceRow {
  device_id: string;
  display_name: string;
  device_type: DeviceType;
  public_key: string;
  identity_fingerprint: string;
  enrolled_by: string;
  enrolled_at: Date;
  state: DeviceEnrollmentState;
  revoked_at: Date | null;
  inventory: DeviceInventory | null;
  inventory_updated_at: Date | null;
}

interface StoredPolicyRow {
  device_id: string;
  policy_version: number;
  rules: LocalDevicePolicy["rules"];
  expires_at: Date | null;
}

const deviceColumns = "device_id, display_name, device_type, public_key, identity_fingerprint, enrolled_by, enrolled_at, state, revoked_at, inventory, inventory_updated_at";
const policyColumns = "device_id, policy_version, rules, expires_at";

function timestamp(value: Date | string | null): string | null {
  return value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function assertValidPersistedDeviceInventory(value: unknown): asserts value is DeviceInventory {
  try {
    assertValidDeviceInventory(value);
  } catch (error) {
    if (error instanceof InvalidDeviceInventoryError) throw new DeviceError(error.message, { cause: error });
    throw error;
  }
}

function mapDevice(device: StoredDeviceRow, policy: StoredPolicyRow): DeviceRecord {
  const enrollment: DeviceEnrollment = {
    deviceId: device.device_id,
    displayName: device.display_name,
    deviceType: device.device_type,
    publicKey: device.public_key,
    identityFingerprint: device.identity_fingerprint.trim(),
    enrolledBy: device.enrolled_by,
    enrolledAt: timestamp(device.enrolled_at)!,
    state: device.state,
    revokedAt: timestamp(device.revoked_at),
  };
  const localPolicy: LocalDevicePolicy = {
    deviceId: policy.device_id,
    policyVersion: policy.policy_version,
    rules: policy.rules,
    expiresAt: timestamp(policy.expires_at),
  };
  assertValidDeviceEnrollment(enrollment);
  if (device.inventory !== null) assertValidPersistedDeviceInventory(device.inventory);
  assertValidLocalDevicePolicy(localPolicy);
  if (policy.device_id !== device.device_id) throw new DeviceError("Device policy is bound to another device");
  return { ...enrollment, inventory: device.inventory, policy: localPolicy };
}

function ensureContext(context: DeviceActorContext, roles: readonly DeviceActorRole[], deviceId?: string): void {
  if (!context || typeof context.actorId !== "string" || context.actorId.trim() === "" || typeof context.sessionRef !== "string" || context.sessionRef.trim() === "") {
    throw new DeviceAuthorizationError("Device mutation requires an actor and session context");
  }
  if (!roles.includes(context.role)) throw new DeviceAuthorizationError("Device actor is not authorized for this mutation");
  if (context.role === "device_agent") {
    if (deviceId === undefined || context.deviceId !== deviceId || typeof context.identityFingerprint !== "string" || context.identityFingerprint.trim() === "") {
      throw new DeviceAuthorizationError("Device agent is not bound to an authenticated device identity");
    }
  }
}

/**
 * Global device administration is deliberately independent of Goal leases and
 * Goal control latches. A device agent gets only an authenticated self-subject
 * check for inventory; it never receives Goal authority from this boundary.
 */
async function authorizeMutation(client: PoolClient, context: DeviceActorContext, roles: readonly DeviceActorRole[], deviceId?: string): Promise<void> {
  ensureContext(context, roles, deviceId);
  if (context.role !== "device_agent" || deviceId === undefined) return;
  const enrolled = await client.query<{ identity_fingerprint: string }>(
    "SELECT identity_fingerprint FROM devices WHERE device_id = $1 FOR KEY SHARE",
    [deviceId],
  );
  if (enrolled.rowCount !== 1 || enrolled.rows[0]!.identity_fingerprint.trim() !== context.identityFingerprint!.trim()) {
    throw new DeviceAuthorizationError("Device agent identity fingerprint does not match the enrolled device");
  }
}

async function readDeviceInTransaction(client: PoolClient, deviceId: string, lock = false): Promise<DeviceRecord> {
  const device = await client.query<StoredDeviceRow>(`SELECT ${deviceColumns} FROM devices WHERE device_id = $1${lock ? " FOR UPDATE" : ""}`, [deviceId]);
  if (device.rowCount !== 1) throw new DeviceNotFoundError(`Device not found: ${deviceId}`);
  const policy = await client.query<StoredPolicyRow>(`SELECT ${policyColumns} FROM device_policies WHERE device_id = $1 ORDER BY policy_version DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`, [deviceId]);
  if (policy.rowCount !== 1) throw new DeviceError("Device has no durable local policy");
  return mapDevice(device.rows[0]!, policy.rows[0]!);
}

async function withMutation<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await operation(client);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Explicit CEO enrollment creates a new durable identity and an empty policy. */
export async function enrollDevice(pool: Pool, input: EnrollDeviceInput, context: DeviceActorContext): Promise<DeviceRecord> {
  if (!input || typeof input.displayName !== "string" || input.displayName.trim() === "") throw new DeviceError("Device displayName is required");
  if (input.deviceType !== "computer" && input.deviceType !== "cli_endpoint") throw new DeviceError("Device type is invalid");
  const publicKey = typeof input.publicKey === "string" ? input.publicKey.trim() : "";
  const identityFingerprint = deviceIdentityFingerprint(publicKey);
  return withMutation(pool, async (client) => {
    await authorizeMutation(client, context, ["ceo"]);
    const deviceId = randomUUID();
    try {
      await client.query(
        `INSERT INTO devices (device_id, display_name, device_type, public_key, identity_fingerprint, enrolled_by, state)
         VALUES ($1, $2, $3, $4, $5, $6, 'enrolled')`,
        [deviceId, input.displayName.trim(), input.deviceType, publicKey, identityFingerprint, context.actorId.trim()],
      );
      await client.query(
        `INSERT INTO device_policies (device_id, policy_version, rules, expires_at, set_by)
         VALUES ($1, 1, '[]'::jsonb, NULL, $2)`,
        [deviceId, context.actorId.trim()],
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") throw new DeviceError("A device with this public key is already enrolled");
      throw error;
    }
    return readDeviceInTransaction(client, deviceId);
  });
}

/** Inventory is durable observed state and can be refreshed by the enrolled device agent or CEO. */
export async function recordDeviceInventory(pool: Pool, deviceId: string, inventory: DeviceInventory, context: DeviceActorContext): Promise<DeviceRecord> {
  assertValidPersistedDeviceInventory(inventory);
  return withMutation(pool, async (client) => {
    await authorizeMutation(client, context, ["ceo", "device_agent"], deviceId);
    const current = await readDeviceInTransaction(client, deviceId, true);
    if (current.state === "revoked") throw new DeviceRevokedError(`Device is revoked: ${deviceId}`);
    await client.query("UPDATE devices SET inventory = $2::jsonb, inventory_updated_at = transaction_timestamp() WHERE device_id = $1", [deviceId, JSON.stringify(inventory)]);
    return readDeviceInTransaction(client, deviceId);
  });
}

/** Replaces the local policy by appending the next immutable revision. */
export async function setLocalDevicePolicy(pool: Pool, deviceId: string, input: LocalDevicePolicyInput, context: DeviceActorContext): Promise<DeviceRecord> {
  return withMutation(pool, async (client) => {
    await authorizeMutation(client, context, ["ceo"], deviceId);
    const current = await readDeviceInTransaction(client, deviceId, true);
    if (current.state === "revoked") throw new DeviceRevokedError(`Device is revoked: ${deviceId}`);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new DeviceError("Local device policy input must be an object");
    const next = { ...input, deviceId, policyVersion: current.policy.policyVersion + 1 } as LocalDevicePolicy;
    assertValidLocalDevicePolicy(next);
    await client.query(
      `INSERT INTO device_policies (device_id, policy_version, rules, expires_at, set_by)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [deviceId, next.policyVersion, JSON.stringify(next.rules), next.expiresAt, context.actorId.trim()],
    );
    return readDeviceInTransaction(client, deviceId);
  });
}

/** Revocation is immediate and one-way; retrying the same revoke returns the durable revoked record. */
export async function revokeDevice(pool: Pool, deviceId: string, context: DeviceActorContext): Promise<DeviceRecord> {
  return withMutation(pool, async (client) => {
    await authorizeMutation(client, context, ["ceo"], deviceId);
    const current = await readDeviceInTransaction(client, deviceId, true);
    if (current.state === "revoked") return current;
    await client.query("UPDATE devices SET state = 'revoked', revoked_at = transaction_timestamp() WHERE device_id = $1 AND state = 'enrolled'", [deviceId]);
    return readDeviceInTransaction(client, deviceId);
  });
}

export async function readDevice(pool: Pick<Pool, "query">, deviceId: string): Promise<DeviceRecord | undefined> {
  const device = await pool.query<StoredDeviceRow>(`SELECT ${deviceColumns} FROM devices WHERE device_id = $1`, [deviceId]);
  if (device.rowCount !== 1) return undefined;
  const policy = await pool.query<StoredPolicyRow>(`SELECT ${policyColumns} FROM device_policies WHERE device_id = $1 ORDER BY policy_version DESC LIMIT 1`, [deviceId]);
  if (policy.rowCount !== 1) throw new DeviceError("Device has no durable local policy");
  return mapDevice(device.rows[0]!, policy.rows[0]!);
}

export async function listDevices(pool: Pick<Pool, "query">): Promise<readonly DeviceRecord[]> {
  const devices = await pool.query<StoredDeviceRow>(`SELECT ${deviceColumns} FROM devices ORDER BY enrolled_at, device_id`);
  const result: DeviceRecord[] = [];
  for (const device of devices.rows) {
    const policy = await pool.query<StoredPolicyRow>(`SELECT ${policyColumns} FROM device_policies WHERE device_id = $1 ORDER BY policy_version DESC LIMIT 1`, [device.device_id]);
    if (policy.rowCount !== 1) throw new DeviceError(`Device has no durable local policy: ${device.device_id}`);
    result.push(mapDevice(device, policy.rows[0]!));
  }
  return result;
}

/** Reads fresh durable enrollment and policy state before the device-local decision. */
export async function evaluateDevicePolicy(pool: Pick<Pool, "query">, request: LocalDeviceActionRequest, now = new Date()): Promise<LocalDevicePolicyDecision> {
  const device = await readDevice(pool, request.deviceId);
  if (device === undefined) throw new DeviceNotFoundError(`Device not found: ${request.deviceId}`);
  // Keep the policy agent's identity input separate from the aggregate's
  // inventory/policy fields; enrollment validation is intentionally strict.
  const enrollment: DeviceEnrollment = {
    deviceId: device.deviceId,
    displayName: device.displayName,
    deviceType: device.deviceType,
    publicKey: device.publicKey,
    identityFingerprint: device.identityFingerprint,
    enrolledBy: device.enrolledBy,
    enrolledAt: device.enrolledAt,
    state: device.state,
    revokedAt: device.revokedAt,
  };
  return new LocalDevicePolicyAgent(enrollment, device.policy).evaluate(request, now);
}
