import {
  assertValidDeviceGrantEnvelope, evaluateLocalDevicePolicy, type DeviceEnrollment, type DeviceGrantEnvelope,
  type DeviceGrantScope, type LocalDevicePolicy,
} from "@maestro/domain";
import { verifyDeviceGrantEnvelope } from "./envelope.js";

export interface LocalDeviceGrantContext {
  readonly enrollment: DeviceEnrollment;
  readonly policy: LocalDevicePolicy;
  readonly scope: DeviceGrantScope;
  readonly expectedGoalId: string;
  readonly expectedProjectId: string;
  readonly expectedGrantId: string;
  readonly issuerKeyId: string;
  readonly issuerPublicKey: string | Buffer;
  readonly previousGoalFencingToken: string;
  readonly previousSequence: number;
  readonly now?: Date;
}

export class LocalDeviceGrantDeniedError extends Error {
  constructor(readonly reason: string) { super(`Local device grant denied: ${reason}`); this.name = "LocalDeviceGrantDeniedError"; }
}

function deny(reason: string): never { throw new LocalDeviceGrantDeniedError(reason); }
function underPath(target: string, root: string): boolean { return target === root || target.startsWith(`${root.replace(/\/$/, "")}/`); }
function includesPath(paths: readonly string[], target: string): boolean { return paths.some((path) => underPath(target, path)); }

/** Device-local checks run before the executor and before any OS effect. */
export function assertLocallyExecutableDeviceGrant(envelope: DeviceGrantEnvelope, context: LocalDeviceGrantContext): void {
  assertValidDeviceGrantEnvelope(envelope);
  const now = context.now ?? new Date();
  if (!verifyDeviceGrantEnvelope(envelope, context.issuerPublicKey)) deny("invalid_signature");
  if (envelope.issuerKeyId !== context.issuerKeyId) deny("issuer_key_mismatch");
  if (envelope.deviceId !== context.enrollment.deviceId) deny("device_identity_mismatch");
  if (envelope.goalId !== context.expectedGoalId) deny("goal_mismatch");
  if (envelope.projectId !== context.expectedProjectId) deny("project_mismatch");
  if (envelope.grantId !== context.expectedGrantId) deny("grant_mismatch");
  if (Date.parse(envelope.expiresAt) <= now.getTime()) deny("grant_expired");
  if (Date.parse(envelope.issuedAt) > now.getTime() + 30_000) deny("issued_at_in_future");
  if (BigInt(envelope.goalFencingToken) < BigInt(context.previousGoalFencingToken)) deny("stale_goal_fence");
  if (envelope.sequence <= context.previousSequence) deny("replayed_sequence");
  if (!includesPath(context.scope.projectPaths, envelope.projectPath) || !underPath(envelope.target, envelope.projectPath)) deny("project_path_scope");
  if (!context.scope.actionTypes.includes(envelope.action)) deny("action_scope");
  if (!context.scope.applications.includes(envelope.application)) deny("application_scope");
  if (!context.scope.dataScope.includes(envelope.dataResource)) deny("data_scope");
  if (!context.scope.networkScope.includes(envelope.networkTarget)) deny("network_scope");
  const policy = evaluateLocalDevicePolicy(context.enrollment, context.policy, {
    deviceId: envelope.deviceId, identityFingerprint: context.enrollment.identityFingerprint, action: envelope.action, target: envelope.target,
  }, now);
  if (!policy.allowed) deny(`local_policy_${policy.reason}`);
  if (policy.policyVersion !== envelope.policyVersion) deny("policy_version");
}
