/**
 * Signed, short-lived authority presented to an enrolled device agent. The
 * capability token is deliberately transported separately and is never part
 * of this signed/loggable envelope.
 */
export interface DeviceGrantEnvelope {
  readonly version: 1;
  readonly grantId: string;
  readonly commandId: string;
  readonly goalId: string;
  readonly projectId: string;
  readonly deviceId: string;
  readonly action: string;
  readonly target: string;
  readonly projectPath: string;
  readonly application: string;
  readonly dataResource: string;
  readonly networkTarget: string;
  readonly policyVersion: number;
  /** Decimal string because PostgreSQL fencing tokens are bigint values. */
  readonly goalFencingToken: string;
  readonly sequence: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly issuerKeyId: string;
  readonly signature: string;
}

export class DeviceGrantEnvelopeError extends Error {
  constructor(message: string) { super(message); this.name = "DeviceGrantEnvelopeError"; }
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.includes("\0");
}

function isoDate(value: unknown): value is string {
  return nonblank(value) && Number.isFinite(Date.parse(value));
}

const FIELDS = [
  "version", "grantId", "commandId", "goalId", "projectId", "deviceId", "action", "target", "projectPath",
  "application", "dataResource", "networkTarget", "policyVersion", "goalFencingToken", "sequence",
  "issuedAt", "expiresAt", "nonce", "issuerKeyId", "signature",
] as const;

export function assertValidDeviceGrantEnvelope(value: unknown): asserts value is DeviceGrantEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DeviceGrantEnvelopeError("Device grant envelope must be an object");
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) if (!(FIELDS as readonly string[]).includes(key)) throw new DeviceGrantEnvelopeError(`Device grant envelope has unknown field ${key}`);
  if (r.version !== 1) throw new DeviceGrantEnvelopeError("Device grant envelope version is unsupported");
  for (const field of ["grantId", "commandId", "goalId", "projectId", "deviceId", "action", "target", "projectPath", "application", "dataResource", "networkTarget", "nonce", "issuerKeyId", "signature"] as const) {
    if (!nonblank(r[field])) throw new DeviceGrantEnvelopeError(`Device grant envelope ${field} is required`);
  }
  if (!Number.isSafeInteger(r.policyVersion) || (r.policyVersion as number) < 1) throw new DeviceGrantEnvelopeError("Device grant envelope policyVersion is invalid");
  if (typeof r.goalFencingToken !== "string" || !/^[1-9][0-9]*$/.test(r.goalFencingToken)) throw new DeviceGrantEnvelopeError("Device grant envelope goalFencingToken is invalid");
  if (!Number.isSafeInteger(r.sequence) || (r.sequence as number) < 1) throw new DeviceGrantEnvelopeError("Device grant envelope sequence is invalid");
  if (!isoDate(r.issuedAt) || !isoDate(r.expiresAt)) throw new DeviceGrantEnvelopeError("Device grant envelope timestamps are invalid");
  if (Date.parse(r.expiresAt as string) <= Date.parse(r.issuedAt as string)) throw new DeviceGrantEnvelopeError("Device grant envelope expiry must follow issue time");
}
