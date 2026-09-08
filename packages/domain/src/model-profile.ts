export const MODEL_CAPABILITY_SCHEMA_VERSION = 1 as const;

export const MODEL_CAPABILITY_AXES = [
  "reasoning",
  "coding",
  "verification",
  "instruction-fidelity",
  "tool-use",
  "long-context",
  "knowledge",
  "refusal-calibration",
] as const;

export type ModelCapabilityAxis = (typeof MODEL_CAPABILITY_AXES)[number];
export type ModelCapabilityScoreStatus = "scored" | "unproven";

export interface ModelCapabilityScore {
  readonly status: ModelCapabilityScoreStatus;
  readonly score: number | null;
  readonly rationale: string;
  readonly evidence: readonly string[];
}

export type ModelCapabilityAxes = Readonly<Record<ModelCapabilityAxis, ModelCapabilityScore>>;

export interface ModelCapabilityVector {
  readonly schemaVersion: typeof MODEL_CAPABILITY_SCHEMA_VERSION;
  readonly axes: ModelCapabilityAxes;
}

export class ModelCapabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCapabilityValidationError";
  }
}

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelCapabilityValidationError(`${name} must be an object`);
  }
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ModelCapabilityValidationError(`${name} has unknown field ${key}`);
  }
}

function nonemptyLine(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new ModelCapabilityValidationError(`${field} must be a non-empty single line`);
  }
}

function evidence(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim() !== "" && !/[\r\n]/.test(item))) {
    throw new ModelCapabilityValidationError(`${field} must contain at least one single-line reference`);
  }
}

function assertValidScore(value: unknown, axis: ModelCapabilityAxis): asserts value is ModelCapabilityScore {
  object(value, `Model capability ${axis}`);
  onlyKeys(value, ["status", "score", "rationale", "evidence"], `Model capability ${axis}`);
  nonemptyLine(value.rationale, `Model capability ${axis} rationale`);
  evidence(value.evidence, `Model capability ${axis} evidence`);

  if (value.status === "scored") {
    if (typeof value.score !== "number" || !Number.isSafeInteger(value.score) || value.score < 0 || value.score > 100) {
      throw new ModelCapabilityValidationError(`Model capability ${axis} score must be an integer in [0,100]`);
    }
    return;
  }

  if (value.status === "unproven") {
    if (value.score !== null) throw new ModelCapabilityValidationError(`Model capability ${axis} unproven score must be null`);
    return;
  }

  throw new ModelCapabilityValidationError(`Model capability ${axis} status must be scored or unproven`);
}

export function assertValidModelCapabilityVector(value: unknown): asserts value is ModelCapabilityVector {
  object(value, "Model capability vector");
  onlyKeys(value, ["schemaVersion", "axes"], "Model capability vector");
  if (value.schemaVersion !== MODEL_CAPABILITY_SCHEMA_VERSION) {
    throw new ModelCapabilityValidationError(`Model capability schemaVersion must be ${MODEL_CAPABILITY_SCHEMA_VERSION}`);
  }

  object(value.axes, "Model capability axes");
  onlyKeys(value.axes, MODEL_CAPABILITY_AXES, "Model capability axes");
  for (const axis of MODEL_CAPABILITY_AXES) {
    if (!(axis in value.axes)) throw new ModelCapabilityValidationError(`Model capability axis ${axis} is required`);
    assertValidScore(value.axes[axis], axis);
  }
}
