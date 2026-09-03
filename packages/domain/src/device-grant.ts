import { canonicalAction, isCriticalOrForbiddenAction } from "./device.js";

export class DeviceGrantScopeError extends Error {
  constructor(message: string) { super(message); this.name = "DeviceGrantScopeError"; }
}
export class DeviceGrantError extends Error {
  constructor(message: string) { super(message); this.name = "DeviceGrantError"; }
}

/**
 * Every Goal-scoped device grant names its own bounded action, path,
 * application, data, and network scope. A grant never widens beyond what it
 * explicitly lists, and it is never a reusable credential -- only the
 * capability reference this scope backs is short-lived.
 */
export interface DeviceGrantScope {
  readonly actionTypes: readonly string[];
  readonly projectPaths: readonly string[];
  readonly applications: readonly string[];
  readonly dataScope: readonly string[];
  readonly networkScope: readonly string[];
}

export type DeviceGrantState = "active" | "expired" | "revoked" | "closed";

export interface DeviceGrant {
  readonly grantId: string;
  readonly goalId: string;
  readonly deviceId: string;
  readonly scope: DeviceGrantScope;
  readonly ceoApproved: boolean;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly state: DeviceGrantState;
  readonly revokedAt: string | null;
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function nonemptyStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonblank);
}

const SCOPE_FIELDS = ["actionTypes", "projectPaths", "applications", "dataScope", "networkScope"] as const;

export function assertValidDeviceGrantScope(value: unknown): asserts value is DeviceGrantScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DeviceGrantScopeError("Device grant scope must be an object");
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!(SCOPE_FIELDS as readonly string[]).includes(key)) throw new DeviceGrantScopeError(`Device grant scope has unknown field ${key}`);
  }
  for (const field of SCOPE_FIELDS) {
    if (!nonemptyStringList(r[field])) throw new DeviceGrantScopeError(`Device grant scope ${field} must be a nonempty string list`);
  }
}

/** A scope naming any critical or forbidden action family crosses the
 * boundary that ordinary execute-then-report device access may not grant by
 * itself; it requires an explicit CEO approval flag on the same request. */
export function deviceGrantRequiresCeoApproval(scope: DeviceGrantScope): boolean {
  assertValidDeviceGrantScope(scope);
  return scope.actionTypes.some((action) => isCriticalOrForbiddenAction(action));
}

export { canonicalAction };

export function assertValidDeviceGrant(value: unknown): asserts value is DeviceGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DeviceGrantError("Device grant must be an object");
  const r = value as Record<string, unknown>;
  for (const field of ["grantId", "goalId", "deviceId", "issuedBy", "issuedAt", "expiresAt"] as const) {
    if (!nonblank(r[field] as unknown)) throw new DeviceGrantError(`Device grant ${field} is required`);
  }
  assertValidDeviceGrantScope(r.scope);
  if (typeof r.ceoApproved !== "boolean") throw new DeviceGrantError("Device grant ceoApproved must be a boolean");
  if (deviceGrantRequiresCeoApproval(r.scope as DeviceGrantScope) && r.ceoApproved !== true) {
    throw new DeviceGrantError("A device grant naming a critical action family requires explicit CEO approval");
  }
  if (!["active", "expired", "revoked", "closed"].includes(r.state as string)) throw new DeviceGrantError("Device grant state is invalid");
  if (r.state === "revoked" && !nonblank(r.revokedAt as unknown)) throw new DeviceGrantError("A revoked device grant requires revokedAt");
  if (r.state !== "revoked" && r.revokedAt !== null) throw new DeviceGrantError("Only a revoked device grant may have revokedAt");
}
