import { calculatePressure, assertValidWorkCharacter, type WorkCharacter } from "./work-character.js";
import type { TaskDemand } from "./task-demand.js";

export const ROUTING_WORK_INPUT_SCHEMA_VERSION = 1 as const;

/**
 * Explicit E (work character) input sealed with the Task Demand.
 *
 * The input is optional on a Mission Bundle so existing pin bundles remain
 * readable. Ensemble admission must require it; absence is never filled from
 * task text, model identity, or a default pressure.
 */
export interface RoutingWorkInput {
  readonly schemaVersion: typeof ROUTING_WORK_INPUT_SCHEMA_VERSION;
  readonly workCharacter: WorkCharacter;
  readonly explicitHeadUplift: number;
}

export class RoutingWorkInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingWorkInputValidationError";
  }
}

type DataObject = Record<string, unknown>;

function object(value: unknown, name: string): asserts value is DataObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RoutingWorkInputValidationError(`${name} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RoutingWorkInputValidationError(`${name} must be a plain object`);
  }
}

function ownDataProperties(value: DataObject, allowed: readonly string[], name: string): DataObject {
  const result: DataObject = Object.create(null) as DataObject;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) {
      throw new RoutingWorkInputValidationError(`${name} has unknown field ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new RoutingWorkInputValidationError(`${name} field ${key} must be an enumerable data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function required(value: DataObject, fields: readonly string[], name: string): void {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new RoutingWorkInputValidationError(`${name} field ${field} is required`);
  }
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new RoutingWorkInputValidationError(`${field} must be a non-empty single line`);
  }
}

/** Validate the explicit E/pressure contract and its binding to sealed demand. */
export function assertValidRoutingWorkInput(value: unknown, taskDemand: TaskDemand): asserts value is RoutingWorkInput {
  object(value, "Routing work input");
  const properties = ownDataProperties(value, ["schemaVersion", "workCharacter", "explicitHeadUplift"], "Routing work input");
  required(properties, ["schemaVersion", "workCharacter", "explicitHeadUplift"], "Routing work input");
  if (properties.schemaVersion !== ROUTING_WORK_INPUT_SCHEMA_VERSION) {
    throw new RoutingWorkInputValidationError(`Routing work input schemaVersion must be ${ROUTING_WORK_INPUT_SCHEMA_VERSION}`);
  }
  try {
    assertValidWorkCharacter(properties.workCharacter);
  } catch (error) {
    throw new RoutingWorkInputValidationError(
      `Routing work input workCharacter is invalid: ${error instanceof Error ? error.message : "unreadable value"}`,
    );
  }
  line(taskDemand.provenance.taskContractRef, "Task demand taskContractRef");
  line(taskDemand.provenance.headDecisionRef, "Task demand headDecisionRef");
  const workCharacter = properties.workCharacter as WorkCharacter;
  if (workCharacter.provenance.taskContractRef !== taskDemand.provenance.taskContractRef) {
    throw new RoutingWorkInputValidationError("Routing work input taskContractRef must match Task Demand provenance");
  }
  if (workCharacter.provenance.headDecisionRef !== taskDemand.provenance.headDecisionRef) {
    throw new RoutingWorkInputValidationError("Routing work input headDecisionRef must match Task Demand provenance");
  }
  try {
    calculatePressure(workCharacter, properties.explicitHeadUplift as number);
  } catch (error) {
    throw new RoutingWorkInputValidationError(
      `Routing work input explicitHeadUplift is invalid: ${error instanceof Error ? error.message : "unreadable value"}`,
    );
  }
}
