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

/** The Sentinel identity is a fixed, reserved actor id; a challenge it raises can never be resolved by that same identity ("It cannot ... certify its own challenge as resolved"). */
export const SENTINEL_ACTOR_ID = "sentinel";

export function assertResolverIsNotSentinel(actorId: string): void {
  if (actorId === SENTINEL_ACTOR_ID) throw new InvalidSentinelChallengeError("Sentinel cannot resolve its own challenge");
}
