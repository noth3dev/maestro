import { SENTINEL_ROLE } from "./organization.js";

export type SentinelChallengeStatus = "open" | "correction_requested" | "safe_paused" | "resolved";

export class InvalidSentinelChallengeError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidSentinelChallengeError"; }
}

export interface SentinelChallengeSubstance {
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidSentinelChallengeError(`${field} is required`);
}
function texts(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) throw new InvalidSentinelChallengeError(`${field} must be a string list`);
}

export function assertValidSentinelChallengeSubstance(value: unknown): asserts value is SentinelChallengeSubstance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidSentinelChallengeError("Sentinel challenge substance must be an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!["reason", "evidenceReferences"].includes(key)) throw new InvalidSentinelChallengeError(`Sentinel challenge substance has unknown field ${key}`);
  text(record.reason, "Sentinel challenge reason");
  texts(record.evidenceReferences, "Sentinel challenge evidenceReferences");
}


export const SENTINEL_ROLE_ID = SENTINEL_ROLE.roleId;
/** @deprecated Use SENTINEL_ROLE_ID; retained for callers that use actor terminology. */
export const SENTINEL_ACTOR_ID = SENTINEL_ROLE_ID;

export function normalizeSentinelIdentity(actorId: string): string {
  return actorId.trim();
}

export function isSentinelRoleIdentity(actorId: string): boolean {
  return normalizeSentinelIdentity(actorId) === SENTINEL_ROLE_ID;
}

/**
 * A resolver cannot certify a challenge raised by the canonical Sentinel role.
 * `raisedBy` is the durable challenge identity, not a caller-selected label.
 */
export function assertResolverIsNotSentinel(actorId: string, raisedBy = SENTINEL_ROLE_ID): void {
  if (isSentinelRoleIdentity(actorId) && isSentinelRoleIdentity(raisedBy)) {
    throw new InvalidSentinelChallengeError("Sentinel cannot resolve its own challenge");
  }
}
