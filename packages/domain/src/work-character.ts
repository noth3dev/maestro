export const WORK_CHARACTER_SCHEMA_VERSION = 1 as const;
export const WORK_CHARACTER_SCORE_MIN = 0 as const;
export const WORK_CHARACTER_SCORE_MAX = 200 as const;

export const WORK_CHARACTER_AXES = Object.freeze([
  "risk",
  "reversibility",
  "verificationAttachment",
  "materialScale",
  "timePressure",
  "budgetHeadroom",
] as const);
export type WorkCharacterAxis = (typeof WORK_CHARACTER_AXES)[number];

export interface WorkCharacter {
  readonly schemaVersion: typeof WORK_CHARACTER_SCHEMA_VERSION;
  readonly risk: number;
  readonly reversibility: number;
  readonly verificationAttachment: number;
  readonly materialScale: number;
  readonly timePressure: number;
  readonly budgetHeadroom: number;
  readonly provenance: {
    readonly taskContractRef: string;
    readonly headDecisionRef: string;
  };
}

export interface PressureCalculation {
  readonly pressureFloor: number;
  readonly pressure: number;
  readonly explicitHeadUplift: number;
}

export class WorkCharacterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkCharacterValidationError";
  }
}

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkCharacterValidationError(`${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new WorkCharacterValidationError(`${name} must be a plain object`);
}

function ownDataProperties(value: Record<string, unknown>, allowed: readonly string[], name: string): Record<string, unknown> {
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key))
      throw new WorkCharacterValidationError(`${name} has unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new WorkCharacterValidationError(`${name} field ${key} must be an enumerable data property`);
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function score(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < WORK_CHARACTER_SCORE_MIN || value > WORK_CHARACTER_SCORE_MAX) {
    throw new WorkCharacterValidationError(`${field} must be an integer in [${WORK_CHARACTER_SCORE_MIN},${WORK_CHARACTER_SCORE_MAX}]`);
  }
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value))
    throw new WorkCharacterValidationError(`${field} must be a non-empty single line`);
}

function validateWorkCharacter(value: unknown): WorkCharacter {
  object(value, "Work character");
  const fields = ["schemaVersion", ...WORK_CHARACTER_AXES, "provenance"] as const;
  const snapshot = ownDataProperties(value, fields, "Work character");
  if (
    !Object.hasOwn(snapshot, "schemaVersion") ||
    !Object.hasOwn(snapshot, "provenance") ||
    WORK_CHARACTER_AXES.some((axis) => !Object.hasOwn(snapshot, axis))
  ) {
    throw new WorkCharacterValidationError("Work character is missing a required field");
  }
  if (snapshot.schemaVersion !== WORK_CHARACTER_SCHEMA_VERSION)
    throw new WorkCharacterValidationError(`Work character schemaVersion must be ${WORK_CHARACTER_SCHEMA_VERSION}`);
  const values = {} as Record<WorkCharacterAxis, number>;
  for (const axis of WORK_CHARACTER_AXES) {
    score(snapshot[axis], `Work character ${axis}`);
    values[axis] = snapshot[axis] as number;
  }
  object(snapshot.provenance, "Work character provenance");
  const provenance = ownDataProperties(snapshot.provenance, ["taskContractRef", "headDecisionRef"], "Work character provenance");
  if (!Object.hasOwn(provenance, "taskContractRef") || !Object.hasOwn(provenance, "headDecisionRef")) {
    throw new WorkCharacterValidationError("Work character provenance is missing a required field");
  }
  line(provenance.taskContractRef, "Work character taskContractRef");
  line(provenance.headDecisionRef, "Work character headDecisionRef");
  return {
    schemaVersion: WORK_CHARACTER_SCHEMA_VERSION,
    risk: values.risk,
    reversibility: values.reversibility,
    verificationAttachment: values.verificationAttachment,
    materialScale: values.materialScale,
    timePressure: values.timePressure,
    budgetHeadroom: values.budgetHeadroom,
    provenance: {
      taskContractRef: provenance.taskContractRef as string,
      headDecisionRef: provenance.headDecisionRef as string,
    },
  };
}

export function assertValidWorkCharacter(value: unknown): asserts value is WorkCharacter {
  validateWorkCharacter(value);
}

function assertHeadUplift(value: unknown): asserts value is number {
  score(value, "Explicit Head uplift");
}

/** Calculate continuous pressure without creating a matching tier or pressure band. */
export function calculatePressure(character: WorkCharacter, explicitHeadUplift: number): PressureCalculation {
  const validated = validateWorkCharacter(character);
  assertHeadUplift(explicitHeadUplift);
  const pressureFloor = (validated.risk + (WORK_CHARACTER_SCORE_MAX - validated.reversibility) + validated.verificationAttachment) / 3;
  return { pressureFloor, pressure: Math.max(pressureFloor, explicitHeadUplift), explicitHeadUplift };
}
