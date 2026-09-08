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

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key))
      throw new WorkCharacterValidationError(`${name} has unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor))
      throw new WorkCharacterValidationError(`${name} field ${key} must be an enumerable data property`);
  }
}

function requiredKeys(value: Record<string, unknown>, required: readonly string[], name: string): void {
  for (const key of required) if (!Object.hasOwn(value, key)) throw new WorkCharacterValidationError(`${name} field ${key} is required`);
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

export function assertValidWorkCharacter(value: unknown): asserts value is WorkCharacter {
  object(value, "Work character");
  const fields = ["schemaVersion", ...WORK_CHARACTER_AXES, "provenance"] as const;
  onlyKeys(value, fields, "Work character");
  requiredKeys(value, fields, "Work character");
  if (value.schemaVersion !== WORK_CHARACTER_SCHEMA_VERSION)
    throw new WorkCharacterValidationError(`Work character schemaVersion must be ${WORK_CHARACTER_SCHEMA_VERSION}`);
  for (const axis of WORK_CHARACTER_AXES) score(value[axis], `Work character ${axis}`);
  object(value.provenance, "Work character provenance");
  onlyKeys(value.provenance, ["taskContractRef", "headDecisionRef"], "Work character provenance");
  requiredKeys(value.provenance, ["taskContractRef", "headDecisionRef"], "Work character provenance");
  line(value.provenance.taskContractRef, "Work character taskContractRef");
  line(value.provenance.headDecisionRef, "Work character headDecisionRef");
}

function assertHeadUplift(value: unknown): asserts value is number {
  score(value, "Explicit Head uplift");
}

/** Calculate continuous pressure without creating a matching tier or pressure band. */
export function calculatePressure(character: WorkCharacter, explicitHeadUplift: number): PressureCalculation {
  assertValidWorkCharacter(character);
  assertHeadUplift(explicitHeadUplift);
  const pressureFloor = (character.risk + (WORK_CHARACTER_SCORE_MAX - character.reversibility) + character.verificationAttachment) / 3;
  return { pressureFloor, pressure: Math.max(pressureFloor, explicitHeadUplift), explicitHeadUplift };
}
