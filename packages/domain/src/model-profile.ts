export const MODEL_CAPABILITY_SCHEMA_VERSION = 2 as const;
export const MODEL_CAPABILITY_SCORE_MIN = 0 as const;
export const MODEL_CAPABILITY_SCORE_MAX = 200 as const;

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
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ModelCapabilityValidationError(`${name} must be a plain object`);
  }
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !allowed.includes(key) || !descriptor?.enumerable || !("value" in descriptor))
      throw new ModelCapabilityValidationError(`${name} has an unknown, hidden, or accessor field ${String(key)}`);
  }
}

function requiredKeys(value: Record<string, unknown>, required: readonly string[], name: string): void {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new ModelCapabilityValidationError(`${name} field ${key} is required`);
  }
}

function nonemptyLine(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new ModelCapabilityValidationError(`${field} must be a non-empty single line`);
  }
}

function evidence(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || Object.getPrototypeOf(value) !== Array.prototype)
    throw new ModelCapabilityValidationError(`${field} must contain at least one single-line reference`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (key === "length") {
      if (!descriptor || descriptor.enumerable || !("value" in descriptor) || descriptor.value !== value.length)
        throw new ModelCapabilityValidationError(`${field} has an invalid length property`);
      continue;
    }
    if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || !descriptor?.enumerable || !("value" in descriptor))
      throw new ModelCapabilityValidationError(`${field} contains an extra or accessor property`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!Object.hasOwn(value, index) || typeof item !== "string" || item.trim() === "" || /[\r\n]/.test(item))
      throw new ModelCapabilityValidationError(`${field} must contain at least one single-line reference`);
  }
}

function assertValidScore(value: unknown, axis: ModelCapabilityAxis): asserts value is ModelCapabilityScore {
  object(value, `Model capability ${axis}`);
  onlyKeys(value, ["status", "score", "rationale", "evidence"], `Model capability ${axis}`);
  requiredKeys(value, ["status", "score", "rationale", "evidence"], `Model capability ${axis}`);
  nonemptyLine(value.rationale, `Model capability ${axis} rationale`);
  evidence(value.evidence, `Model capability ${axis} evidence`);

  if (value.status === "scored") {
    if (typeof value.score !== "number" || !Number.isSafeInteger(value.score) || value.score < MODEL_CAPABILITY_SCORE_MIN || value.score > MODEL_CAPABILITY_SCORE_MAX) {
      throw new ModelCapabilityValidationError(`Model capability ${axis} score must be an integer in [${MODEL_CAPABILITY_SCORE_MIN},${MODEL_CAPABILITY_SCORE_MAX}]`);
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
  requiredKeys(value, ["schemaVersion", "axes"], "Model capability vector");
  if (value.schemaVersion !== MODEL_CAPABILITY_SCHEMA_VERSION) {
    throw new ModelCapabilityValidationError(`Model capability schemaVersion must be ${MODEL_CAPABILITY_SCHEMA_VERSION}`);
  }

  object(value.axes, "Model capability axes");
  onlyKeys(value.axes, MODEL_CAPABILITY_AXES, "Model capability axes");
  for (const axis of MODEL_CAPABILITY_AXES) {
    if (!Object.hasOwn(value.axes, axis)) throw new ModelCapabilityValidationError(`Model capability axis ${axis} is required`);
    assertValidScore(value.axes[axis], axis);
  }
}
