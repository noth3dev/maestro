export class DeviceCommandResultError extends Error {
  constructor(message: string) { super(message); this.name = "DeviceCommandResultError"; }
}

const MAX_SUMMARY_LENGTH = 4096;
const SECRET_LIKE = /(?:authorization\s*:\s*bearer|password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key|credential)/i;

/**
 * A device command result is a bounded, redaction-checked summary of one
 * executed command, sequenced per grant so a stale or replayed result
 * cannot be accepted after a successor has already used the grant's
 * fencing sequence.
 */
export interface DeviceCommandResult {
  readonly commandId: string;
  readonly grantId: string;
  readonly action: string;
  readonly target: string;
  readonly sequence: number;
  readonly resultSummary: string;
  readonly executedAt: string;
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

const FIELDS = ["commandId", "grantId", "action", "target", "sequence", "resultSummary", "executedAt"] as const;

export function assertValidDeviceCommandResult(value: unknown): asserts value is DeviceCommandResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DeviceCommandResultError("Device command result must be an object");
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!(FIELDS as readonly string[]).includes(key)) throw new DeviceCommandResultError(`Device command result has unknown field ${key}`);
  }
  for (const field of ["commandId", "grantId", "action", "target", "resultSummary", "executedAt"] as const) {
    if (!nonblank(r[field])) throw new DeviceCommandResultError(`Device command result ${field} is required`);
  }
  if (!Number.isSafeInteger(r.sequence) || (r.sequence as number) < 1) {
    throw new DeviceCommandResultError("Device command result sequence must be a positive safe integer");
  }
  const summary = r.resultSummary as string;
  if (summary.length > MAX_SUMMARY_LENGTH) throw new DeviceCommandResultError("Device command result summary exceeds its size limit");
  if (summary.includes("\0")) throw new DeviceCommandResultError("Device command result summary contains a NUL character");
  if (SECRET_LIKE.test(summary)) throw new DeviceCommandResultError("Device command result summary must not contain secret-like material");
  if (!Number.isFinite(Date.parse(r.executedAt as string))) throw new DeviceCommandResultError("Device command result executedAt must be an ISO date");
}
