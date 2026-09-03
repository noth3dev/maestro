import { createHash } from "node:crypto";

export type DeviceType = "computer" | "cli_endpoint";
export type DeviceEnrollmentState = "enrolled" | "revoked";

export interface DeviceCapability {
  readonly name: string;
  readonly version: string;
}

/** Inventory is observed fact, not authority. It never contains credential material. */
export interface DeviceInventory {
  readonly observedAt: string;
  readonly platform: string;
  readonly architecture: string;
  readonly capabilities: readonly DeviceCapability[];
  readonly applications: readonly DeviceCapability[];
}

/** Stable device identity established by explicit enrollment. */
export interface DeviceEnrollment {
  readonly deviceId: string;
  readonly displayName: string;
  readonly deviceType: DeviceType;
  /** Public verification key material. Private keys are never accepted or persisted. */
  readonly publicKey: string;
  readonly identityFingerprint: string;
  readonly enrolledBy: string;
  readonly enrolledAt: string;
  readonly state: DeviceEnrollmentState;
  readonly revokedAt: string | null;
}

/** Policy is a separate authority object; enrollment alone grants no action. */
export interface LocalDevicePolicy {
  readonly deviceId: string;
  readonly policyVersion: number;
  readonly rules: readonly LocalDevicePolicyRule[];
  readonly expiresAt: string | null;
}

export type LocalDevicePolicyInput = Omit<LocalDevicePolicy, "deviceId" | "policyVersion">;

export interface LocalDevicePolicyRule {
  readonly action: string;
  /** Exact targets keep local policy allowlists bounded and auditable. */
  readonly targets: readonly string[];
}

export interface DeviceRecord extends DeviceEnrollment {
  readonly inventory: DeviceInventory | null;
  readonly policy: LocalDevicePolicy;
}

export interface LocalDeviceActionRequest {
  readonly deviceId: string;
  readonly identityFingerprint: string;
  readonly action: string;
  readonly target: string;
}

export type LocalDevicePolicyDecisionReason =
  | "allowed"
  | "device_identity_mismatch"
  | "invalid_request"
  | "device_revoked"
  | "policy_device_mismatch"
  | "policy_expired"
  | "critical_action_requires_goal_grant"
  | "action_not_allowed"
  | "target_not_allowed";

export interface LocalDevicePolicyDecision {
  readonly allowed: boolean;
  readonly reason: LocalDevicePolicyDecisionReason;
  readonly policyVersion: number;
}

export class InvalidDeviceEnrollmentError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidDeviceEnrollmentError"; }
}
export class InvalidDeviceInventoryError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidDeviceInventoryError"; }
}
export class InvalidLocalDevicePolicyError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidLocalDevicePolicyError"; }
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validTimestamp(value: unknown): value is string {
  if (!nonblank(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidDeviceEnrollmentError(`${name} must be an object`);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string, error: (message: string) => Error): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw error(`${name} has unknown field ${key}`);
}

export function canonicalAction(action: string): string {
  return action.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

export function isCriticalOrForbiddenAction(action: string): boolean {
  const canonical = canonicalAction(action);
  return canonical === "system.policy.bypass" ||
    canonical === "permanent.delete" ||
    canonical.startsWith("external.") ||
    canonical.startsWith("deployment.") ||
    canonical.startsWith("payment.") ||
    canonical.startsWith("permission.") ||
    canonical.startsWith("authority.") ||
    canonical.startsWith("git.remote.") ||
    canonical === "git.push" ||
    canonical.startsWith("git.push.");
}

/** Hashes normalized public verification material with Node's standard SHA-256. */
export function deviceIdentityFingerprint(publicKey: string): string {
  if (!nonblank(publicKey) || /PRIVATE KEY|BEGIN [A-Z ]*SECRET KEY/i.test(publicKey)) {
    throw new InvalidDeviceEnrollmentError("A device identity requires public key material, not a private key");
  }
  return createHash("sha256").update(publicKey.trim(), "utf8").digest("hex");
}

export function assertValidDeviceEnrollment(value: unknown): asserts value is DeviceEnrollment {
  object(value, "Device enrollment");
  const r = value;
  onlyKeys(r, ["deviceId", "displayName", "deviceType", "publicKey", "identityFingerprint", "enrolledBy", "enrolledAt", "state", "revokedAt"], "Device enrollment", (message) => new InvalidDeviceEnrollmentError(message));
  for (const field of ["deviceId", "displayName", "publicKey", "enrolledBy"] as const) {
    if (!nonblank(r[field])) throw new InvalidDeviceEnrollmentError(`Device ${field} is required`);
  }
  if (r.deviceType !== "computer" && r.deviceType !== "cli_endpoint") throw new InvalidDeviceEnrollmentError("Device type is invalid");
  if (!validTimestamp(r.enrolledAt)) throw new InvalidDeviceEnrollmentError("Device enrolledAt is invalid");
  if (r.state !== "enrolled" && r.state !== "revoked") throw new InvalidDeviceEnrollmentError("Device enrollment state is invalid");
  if (r.state === "enrolled" && r.revokedAt !== null) throw new InvalidDeviceEnrollmentError("An enrolled device cannot have revokedAt");
  if (r.state === "revoked" && !validTimestamp(r.revokedAt)) throw new InvalidDeviceEnrollmentError("A revoked device requires revokedAt");
  if (!/^[0-9a-f]{64}$/.test(String(r.identityFingerprint)) || deviceIdentityFingerprint(r.publicKey as string) !== r.identityFingerprint) {
    throw new InvalidDeviceEnrollmentError("Device identity fingerprint does not match its public key");
  }
}

function assertCapability(value: unknown, field: string): asserts value is DeviceCapability {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidDeviceInventoryError(`${field} must be an object`);
  const capability = value as Record<string, unknown>;
  onlyKeys(capability, ["name", "version"], field, (message) => new InvalidDeviceInventoryError(message));
  if (!nonblank(capability.name) || !nonblank(capability.version)) throw new InvalidDeviceInventoryError(`${field} name and version are required`);
  const material = `${capability.name as string} ${capability.version as string}`;
  if (/secret|password|token|private.?key|credential/i.test(material) || /[=\n]/.test(material)) {
    throw new InvalidDeviceInventoryError("Inventory capability values must not contain secret-like material");
  }
}

export function assertValidDeviceInventory(value: unknown): asserts value is DeviceInventory {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidDeviceInventoryError("Device inventory must be an object");
  const r = value as Record<string, unknown>;
  onlyKeys(r, ["observedAt", "platform", "architecture", "capabilities", "applications"], "Device inventory", (message) => new InvalidDeviceInventoryError(message));
  if (!validTimestamp(r.observedAt) || !nonblank(r.platform) || !nonblank(r.architecture)) throw new InvalidDeviceInventoryError("Device inventory metadata is invalid");
  for (const field of ["capabilities", "applications"] as const) {
    if (!Array.isArray(r[field])) throw new InvalidDeviceInventoryError(`Device inventory ${field} must be a list`);
    for (const capability of r[field]) assertCapability(capability, `Device inventory ${field} entry`);
  }
}

export function assertValidLocalDevicePolicy(value: unknown): asserts value is LocalDevicePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidLocalDevicePolicyError("Local device policy must be an object");
  const r = value as Record<string, unknown>;
  onlyKeys(r, ["deviceId", "policyVersion", "rules", "expiresAt"], "Local device policy", (message) => new InvalidLocalDevicePolicyError(message));
  if (!nonblank(r.deviceId)) throw new InvalidLocalDevicePolicyError("Local device policy deviceId is required");
  if (!Number.isSafeInteger(r.policyVersion) || (r.policyVersion as number) < 1) throw new InvalidLocalDevicePolicyError("Local device policy version must be a positive safe integer");
  if (!Array.isArray(r.rules)) throw new InvalidLocalDevicePolicyError("Local device policy rules must be a list");
  for (const ruleValue of r.rules) {
    if (!ruleValue || typeof ruleValue !== "object" || Array.isArray(ruleValue)) throw new InvalidLocalDevicePolicyError("Local device policy rule must be an object");
    const rule = ruleValue as Record<string, unknown>;
    onlyKeys(rule, ["action", "targets"], "Local device policy rule", (message) => new InvalidLocalDevicePolicyError(message));
    if (!nonblank(rule.action)) throw new InvalidLocalDevicePolicyError("Local device policy action is required");
    if (isCriticalOrForbiddenAction(rule.action as string)) throw new InvalidLocalDevicePolicyError("Critical or forbidden actions require the Goal grant and cannot be enabled by local policy");
    if (!Array.isArray(rule.targets) || rule.targets.length === 0 || !rule.targets.every(nonblank)) throw new InvalidLocalDevicePolicyError("Local device policy targets must be a nonempty string list");
  }
  if (r.expiresAt !== null && !validTimestamp(r.expiresAt)) throw new InvalidLocalDevicePolicyError("Local device policy expiresAt is invalid");
}

/** Pure local enforcement. It does not infer authority from inventory capabilities. */
export function evaluateLocalDevicePolicy(
  enrollment: DeviceEnrollment,
  policy: LocalDevicePolicy,
  request: LocalDeviceActionRequest,
  now = new Date(),
): LocalDevicePolicyDecision {
  assertValidDeviceEnrollment(enrollment);
  assertValidLocalDevicePolicy(policy);
  if (!request || typeof request !== "object" || !nonblank(request.deviceId) || !nonblank(request.identityFingerprint) || !nonblank(request.action) || !nonblank(request.target)) {
    return { allowed: false, reason: "invalid_request", policyVersion: policy.policyVersion };
  }
  if (request.deviceId !== enrollment.deviceId || request.identityFingerprint !== enrollment.identityFingerprint) return { allowed: false, reason: "device_identity_mismatch", policyVersion: policy.policyVersion };
  if (enrollment.state === "revoked") return { allowed: false, reason: "device_revoked", policyVersion: policy.policyVersion };
  if (policy.deviceId !== enrollment.deviceId) return { allowed: false, reason: "policy_device_mismatch", policyVersion: policy.policyVersion };
  if (policy.expiresAt !== null && new Date(policy.expiresAt).getTime() <= now.getTime()) return { allowed: false, reason: "policy_expired", policyVersion: policy.policyVersion };
  if (isCriticalOrForbiddenAction(request.action)) return { allowed: false, reason: "critical_action_requires_goal_grant", policyVersion: policy.policyVersion };
  const rule = policy.rules.find((candidate) => candidate.action === request.action);
  if (rule === undefined) return { allowed: false, reason: "action_not_allowed", policyVersion: policy.policyVersion };
  if (!rule.targets.includes(request.target)) return { allowed: false, reason: "target_not_allowed", policyVersion: policy.policyVersion };
  return { allowed: true, reason: "allowed", policyVersion: policy.policyVersion };
}

/** A device-local decision point. Goal grants and transport authentication remain separate later layers. */
export class LocalDevicePolicyAgent {
  constructor(
    private readonly enrollment: DeviceEnrollment,
    private readonly policy: LocalDevicePolicy,
  ) {
    assertValidDeviceEnrollment(enrollment);
    assertValidLocalDevicePolicy(policy);
  }

  evaluate(request: LocalDeviceActionRequest, now = new Date()): LocalDevicePolicyDecision {
    return evaluateLocalDevicePolicy(this.enrollment, this.policy, request, now);
  }
}
