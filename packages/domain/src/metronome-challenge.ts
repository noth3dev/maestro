import { METRONOME_ROLE } from "./organization.js";

export type MetronomeChallengeStatus = "open" | "correction_requested" | "safe_paused" | "resolved";

export class InvalidMetronomeChallengeError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidMetronomeChallengeError"; }
}

export interface MetronomeChallengeSubstance {
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidMetronomeChallengeError(`${field} is required`);
}
function texts(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) throw new InvalidMetronomeChallengeError(`${field} must be a string list`);
}

export function assertValidMetronomeChallengeSubstance(value: unknown): asserts value is MetronomeChallengeSubstance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidMetronomeChallengeError("Metronome challenge substance must be an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!["reason", "evidenceReferences"].includes(key)) throw new InvalidMetronomeChallengeError(`Metronome challenge substance has unknown field ${key}`);
  text(record.reason, "Metronome challenge reason");
  texts(record.evidenceReferences, "Metronome challenge evidenceReferences");
}


export const METRONOME_ROLE_ID = METRONOME_ROLE.roleId;
/** @deprecated Use METRONOME_ROLE_ID; retained for callers that use actor terminology. */
export const METRONOME_ACTOR_ID = METRONOME_ROLE_ID;

export function normalizeMetronomeIdentity(actorId: string): string {
  return actorId.trim();
}

export function isMetronomeRoleIdentity(actorId: string): boolean {
  return normalizeMetronomeIdentity(actorId) === METRONOME_ROLE_ID;
}

/**
 * A resolver cannot certify a challenge raised by the canonical Metronome role.
 * `raisedBy` is the durable challenge identity, not a caller-selected label.
 */
export function assertResolverIsNotMetronome(actorId: string, raisedBy = METRONOME_ROLE_ID): void {
  if (isMetronomeRoleIdentity(actorId) && isMetronomeRoleIdentity(raisedBy)) {
    throw new InvalidMetronomeChallengeError("Metronome cannot resolve its own challenge");
  }
}
