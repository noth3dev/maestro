import {
  MODEL_CAPABILITY_AXES,
  MODEL_CAPABILITY_SCORE_MAX,
  MODEL_CAPABILITY_SCORE_MIN,
  type ModelCapabilityAxis,
} from "./model-profile.js";

export const TASK_KIND_RECIPE_SCHEMA_VERSION = 1 as const;
export const TASK_DEMAND_SCHEMA_VERSION = 1 as const;

export const TASK_KINDS = [
  "planning",
  "coding",
  "verification",
  "research",
  "debugging",
  "tool-operation",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskKindAxisRole = "unused" | "supporting" | "primary";
export type TaskKindAxisRoles = Readonly<Record<ModelCapabilityAxis, TaskKindAxisRole>>;

export interface TaskKindRecipe {
  readonly schemaVersion: typeof TASK_KIND_RECIPE_SCHEMA_VERSION;
  readonly kind: TaskKind;
  readonly rationale: string;
  readonly axisRoles: TaskKindAxisRoles;
}

export interface TaskCapabilityRequirement {
  readonly level: number;
  readonly rationale: string;
}

export type TaskCapabilityRequirements = Readonly<Record<ModelCapabilityAxis, TaskCapabilityRequirement>>;

export interface TaskDemand {
  readonly schemaVersion: typeof TASK_DEMAND_SCHEMA_VERSION;
  readonly taskKinds: readonly TaskKind[];
  readonly requirements: TaskCapabilityRequirements;
  readonly provenance: {
    readonly taskContractRef: string;
    readonly headDecisionRef: string;
  };
}

export interface TaskDemandDeclaration {
  readonly taskKinds: readonly TaskKind[];
  readonly requirements: TaskCapabilityRequirements;
  readonly taskContractRef: string;
  readonly headDecisionRef: string;
}

export class TaskDemandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskDemandValidationError";
  }
}

type AxisRoleInput = Partial<Record<ModelCapabilityAxis, TaskKindAxisRole>>;

const roles = (overrides: AxisRoleInput): TaskKindAxisRoles =>
  Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, overrides[axis] ?? "unused"])) as TaskKindAxisRoles;

export const TASK_KIND_RECIPES: readonly TaskKindRecipe[] = [
  {
    schemaVersion: TASK_KIND_RECIPE_SCHEMA_VERSION,
    kind: "planning",
    rationale: "Planning emphasizes reasoning, instruction fidelity, and context-aware synthesis.",
    axisRoles: roles({ reasoning: "primary", "instruction-fidelity": "primary", "long-context": "supporting", knowledge: "supporting", verification: "supporting", "refusal-calibration": "supporting" }),
  },
  {
    schemaVersion: TASK_KIND_RECIPE_SCHEMA_VERSION,
    kind: "coding",
    rationale: "Coding emphasizes accurate implementation and faithful bounded changes.",
    axisRoles: roles({ coding: "primary", "instruction-fidelity": "primary", reasoning: "supporting", verification: "supporting", "tool-use": "supporting", "long-context": "supporting", "refusal-calibration": "supporting" }),
  },
  {
    schemaVersion: TASK_KIND_RECIPE_SCHEMA_VERSION,
    kind: "verification",
    rationale: "Verification emphasizes defect discovery, reasoning, and evidence-grounded judgment.",
    axisRoles: roles({ verification: "primary", reasoning: "primary", coding: "supporting", "instruction-fidelity": "supporting", "tool-use": "supporting", "long-context": "supporting", knowledge: "supporting", "refusal-calibration": "supporting" }),
  },
  {
    schemaVersion: TASK_KIND_RECIPE_SCHEMA_VERSION,
    kind: "research",
    rationale: "Research emphasizes factual knowledge, long-context use, and source-aware synthesis.",
    axisRoles: roles({ knowledge: "primary", "long-context": "primary", reasoning: "supporting", verification: "supporting", "instruction-fidelity": "supporting", "tool-use": "supporting", "refusal-calibration": "supporting" }),
  },
  {
    schemaVersion: TASK_KIND_RECIPE_SCHEMA_VERSION,
    kind: "debugging",
    rationale: "Debugging combines implementation, defect isolation, reasoning, and bounded tool recovery.",
    axisRoles: roles({ coding: "primary", verification: "primary", reasoning: "primary", "instruction-fidelity": "primary", "tool-use": "supporting", "long-context": "supporting", knowledge: "supporting", "refusal-calibration": "supporting" }),
  },
  {
    schemaVersion: TASK_KIND_RECIPE_SCHEMA_VERSION,
    kind: "tool-operation",
    rationale: "Tool operation emphasizes exact instruction fidelity, safe calls, and calibrated refusal.",
    axisRoles: roles({ "tool-use": "primary", "instruction-fidelity": "primary", "refusal-calibration": "primary", reasoning: "supporting", verification: "supporting", "long-context": "supporting" }),
  },
];

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskDemandValidationError(`${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TaskDemandValidationError(`${name} must be a plain object`);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw new TaskDemandValidationError(`${name} has unknown field ${String(key)}`);
  }
}

function requiredKeys(value: Record<string, unknown>, required: readonly string[], name: string): void {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TaskDemandValidationError(`${name} field ${key} is required`);
  }
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) throw new TaskDemandValidationError(`${field} must be a non-empty single line`);
}

function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
}

function assertTaskKinds(value: unknown, field: string): asserts value is readonly TaskKind[] {
  if (!Array.isArray(value) || value.length === 0) throw new TaskDemandValidationError(`${field} must be a non-empty list`);
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!Object.hasOwn(value, index) || !isTaskKind(item)) throw new TaskDemandValidationError(`${field} contains an unknown task kind`);
    if (seen.has(item)) throw new TaskDemandValidationError(`${field} cannot contain duplicate task kinds`);
    seen.add(item);
  }
}

function assertAxisRoles(value: unknown, field: string): asserts value is TaskKindAxisRoles {
  object(value, field);
  onlyKeys(value, MODEL_CAPABILITY_AXES, field);
  for (const axis of MODEL_CAPABILITY_AXES) {
    if (!Object.hasOwn(value, axis)) throw new TaskDemandValidationError(`${field} axis ${axis} is required`);
    const role = value[axis];
    if (role !== "unused" && role !== "supporting" && role !== "primary") {
      throw new TaskDemandValidationError(`${field} axis ${axis} has an invalid role`);
    }
  }
}

export function assertValidTaskKindRecipe(value: unknown): asserts value is TaskKindRecipe {
  object(value, "Task-kind recipe");
  onlyKeys(value, ["schemaVersion", "kind", "rationale", "axisRoles"], "Task-kind recipe");
  requiredKeys(value, ["schemaVersion", "kind", "rationale", "axisRoles"], "Task-kind recipe");
  if (value.schemaVersion !== TASK_KIND_RECIPE_SCHEMA_VERSION) throw new TaskDemandValidationError(`Task-kind recipe schemaVersion must be ${TASK_KIND_RECIPE_SCHEMA_VERSION}`);
  if (!isTaskKind(value.kind)) throw new TaskDemandValidationError("Task-kind recipe kind is unknown");
  line(value.rationale, "Task-kind recipe rationale");
  assertAxisRoles(value.axisRoles, "Task-kind recipe axisRoles");
}

function assertRequirement(value: unknown, axis: ModelCapabilityAxis): asserts value is TaskCapabilityRequirement {
  object(value, `Task demand ${axis}`);
  onlyKeys(value, ["level", "rationale"], `Task demand ${axis}`);
  requiredKeys(value, ["level", "rationale"], `Task demand ${axis}`);
  if (typeof value.level !== "number" || !Number.isSafeInteger(value.level) || value.level < MODEL_CAPABILITY_SCORE_MIN || value.level > MODEL_CAPABILITY_SCORE_MAX) {
    throw new TaskDemandValidationError(`Task demand ${axis} level must be an integer in [${MODEL_CAPABILITY_SCORE_MIN},${MODEL_CAPABILITY_SCORE_MAX}]`);
  }
  line(value.rationale, `Task demand ${axis} rationale`);
}

function assertRequirements(value: unknown): asserts value is TaskCapabilityRequirements {
  object(value, "Task demand requirements");
  onlyKeys(value, MODEL_CAPABILITY_AXES, "Task demand requirements");
  for (const axis of MODEL_CAPABILITY_AXES) {
    if (!Object.hasOwn(value, axis)) throw new TaskDemandValidationError(`Task demand axis ${axis} is required`);
    assertRequirement(value[axis], axis);
  }
}

export function assertValidTaskDemand(value: unknown): asserts value is TaskDemand {
  object(value, "Task demand");
  onlyKeys(value, ["schemaVersion", "taskKinds", "requirements", "provenance"], "Task demand");
  requiredKeys(value, ["schemaVersion", "taskKinds", "requirements", "provenance"], "Task demand");
  if (value.schemaVersion !== TASK_DEMAND_SCHEMA_VERSION) throw new TaskDemandValidationError(`Task demand schemaVersion must be ${TASK_DEMAND_SCHEMA_VERSION}`);
  assertTaskKinds(value.taskKinds, "Task demand taskKinds");
  assertRequirements(value.requirements);
  object(value.provenance, "Task demand provenance");
  onlyKeys(value.provenance, ["taskContractRef", "headDecisionRef"], "Task demand provenance");
  requiredKeys(value.provenance, ["taskContractRef", "headDecisionRef"], "Task demand provenance");
  line(value.provenance.taskContractRef, "Task demand taskContractRef");
  line(value.provenance.headDecisionRef, "Task demand headDecisionRef");
}

/** Seal explicit Head levels; this function never derives numbers from task-kind recipes. */
export function declareTaskDemand(value: unknown): TaskDemand {
  object(value, "Task demand declaration");
  onlyKeys(value, ["taskKinds", "requirements", "taskContractRef", "headDecisionRef"], "Task demand declaration");
  requiredKeys(value, ["taskKinds", "requirements", "taskContractRef", "headDecisionRef"], "Task demand declaration");
  const candidate = {
    schemaVersion: TASK_DEMAND_SCHEMA_VERSION,
    taskKinds: value.taskKinds,
    requirements: value.requirements,
    provenance: { taskContractRef: value.taskContractRef, headDecisionRef: value.headDecisionRef },
  };
  assertValidTaskDemand(candidate);
  return {
    schemaVersion: candidate.schemaVersion,
    taskKinds: [...candidate.taskKinds],
    requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { ...candidate.requirements[axis] }])) as TaskCapabilityRequirements,
    provenance: { ...candidate.provenance },
  };
}

export function getTaskKindRecipe(kind: TaskKind): TaskKindRecipe {
  const recipe = TASK_KIND_RECIPES.find((candidate) => candidate.kind === kind);
  if (!recipe) throw new TaskDemandValidationError(`Unknown task kind ${String(kind)}`);
  return recipe;
}

const ROLE_RANK: Record<TaskKindAxisRole, number> = { unused: 0, supporting: 1, primary: 2 };

export function composeTaskKindEmphasis(taskKinds: readonly TaskKind[]): TaskKindAxisRoles {
  assertTaskKinds(taskKinds, "Task kinds");
  const combined = Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, "unused" as TaskKindAxisRole])) as Record<ModelCapabilityAxis, TaskKindAxisRole>;
  for (const kind of taskKinds) {
    const recipe = getTaskKindRecipe(kind);
    for (const axis of MODEL_CAPABILITY_AXES) {
      if (ROLE_RANK[recipe.axisRoles[axis]] > ROLE_RANK[combined[axis]]) combined[axis] = recipe.axisRoles[axis];
    }
  }
  return combined;
}
