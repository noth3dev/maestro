export class InvalidTeamLeadGrantError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidTeamLeadGrantError"; }
}

/** A Head grants this to a bounded team-lead worker for one large mission; unbounded recursive spawning is forbidden by construction (only a non-helper worker may receive a grant). */
export interface TeamLeadGrantSubstance {
  readonly reason: string;
  readonly maxHelpers: number;
  readonly costCeiling: string;
  readonly durationCeiling: string;
  readonly taskScope: string;
  readonly reportingRequirement: string;
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidTeamLeadGrantError(`${field} is required`);
}
function positiveInt(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new InvalidTeamLeadGrantError(`${field} must be a positive safe integer`);
}
function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidTeamLeadGrantError(`${name} must be an object`);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new InvalidTeamLeadGrantError(`${name} has unknown field ${key}`);
}

export function assertValidTeamLeadGrantSubstance(value: unknown): asserts value is TeamLeadGrantSubstance {
  object(value, "Team-lead grant substance");
  const fields = ["reason", "maxHelpers", "costCeiling", "durationCeiling", "taskScope", "reportingRequirement"] as const;
  onlyKeys(value, fields, "Team-lead grant substance");
  text(value.reason, "Team-lead grant reason");
  positiveInt(value.maxHelpers, "Team-lead grant maxHelpers");
  text(value.costCeiling, "Team-lead grant costCeiling");
  text(value.durationCeiling, "Team-lead grant durationCeiling");
  text(value.taskScope, "Team-lead grant taskScope");
  text(value.reportingRequirement, "Team-lead grant reportingRequirement");
}
