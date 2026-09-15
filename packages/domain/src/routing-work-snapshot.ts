import { assertValidOperationalOverlaySnapshot, type OperationalOverlaySnapshot } from "./operational-overlay.js";
import { assertValidRoutingWorkInput, type RoutingWorkInput } from "./routing-work-input.js";
import { assertValidTaskDemand, type TaskDemand } from "./task-demand.js";

export const ROUTING_WORK_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface RoutingWorkSnapshotInput {
  readonly goalRef: string;
  readonly projectRef: string;
  /** Mission Bundle content hash; this binds selector input to durable work. */
  readonly missionBundleRef: string;
  readonly approvedModels: readonly string[];
  readonly taskDemand: TaskDemand;
  readonly routingWorkInput: RoutingWorkInput | undefined;
  readonly operationalOverlay: OperationalOverlaySnapshot;
}

export interface RoutingWorkSnapshot extends RoutingWorkSnapshotInput {
  readonly schemaVersion: typeof ROUTING_WORK_SNAPSHOT_SCHEMA_VERSION;
  readonly routingWorkInput: RoutingWorkInput;
}

export class RoutingWorkSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingWorkSnapshotValidationError";
  }
}

function line(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new RoutingWorkSnapshotValidationError(`${field} must be a non-empty single line`);
  }
}

function modelRef(value: unknown, field: string): asserts value is string {
  line(value, field);
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1 || value.indexOf("/", slash + 1) !== -1 || /\s/.test(value)) {
    throw new RoutingWorkSnapshotValidationError(`${field} must be an exact provider/model identity`);
  }
}

function plain(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoutingWorkSnapshotValidationError(`${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new RoutingWorkSnapshotValidationError(`${name} must be a plain object`);
}

function strictProperties(value: unknown, allowed: readonly string[], required: readonly string[], name: string): Record<string, unknown> {
  plain(value, name);
  const record = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw new RoutingWorkSnapshotValidationError(`${name} has unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new RoutingWorkSnapshotValidationError(`${name} field ${key} must be an enumerable data property`);
  }
  for (const key of required) if (!Object.hasOwn(record, key)) throw new RoutingWorkSnapshotValidationError(`${name} field ${key} is required`);
  return record;
}

function standardStringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0) throw new RoutingWorkSnapshotValidationError(`${name} must be a non-empty standard Array`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) throw new RoutingWorkSnapshotValidationError(`${name} has an unknown field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new RoutingWorkSnapshotValidationError(`${name} entries must be enumerable data properties`);
  }
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) throw new RoutingWorkSnapshotValidationError(`${name} must not be sparse`);
  return value as readonly string[];
}

function deepFreezeClone<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => deepFreezeClone(item))) as T;
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) result[key] = deepFreezeClone(child);
    return Object.freeze(result) as T;
  }
  return value;
}

function inputProperties(value: unknown): RoutingWorkSnapshotInput {
  const record = strictProperties(value, ["goalRef", "projectRef", "missionBundleRef", "approvedModels", "taskDemand", "routingWorkInput", "operationalOverlay"], ["goalRef", "projectRef", "missionBundleRef", "approvedModels", "taskDemand", "routingWorkInput", "operationalOverlay"], "Routing work snapshot");
  return record as unknown as RoutingWorkSnapshotInput;
}

function validate(value: RoutingWorkSnapshotInput): RoutingWorkSnapshot {
  const input = inputProperties(value);
  line(input.goalRef, "Routing work snapshot goalRef");
  line(input.projectRef, "Routing work snapshot projectRef");
  line(input.missionBundleRef, "Routing work snapshot missionBundleRef");
  const approvedModels = standardStringArray(input.approvedModels, "Routing work snapshot approvedModels");
  const approved = new Set<string>();
  for (const model of approvedModels) {
    modelRef(model, "Routing work snapshot approvedModels entry");
    if (approved.has(model)) throw new RoutingWorkSnapshotValidationError("Routing work snapshot approvedModels must not contain duplicates");
    approved.add(model);
  }
  try {
    assertValidTaskDemand(input.taskDemand);
    if (input.routingWorkInput === undefined) throw new Error("routingWorkInput is absent");
    assertValidRoutingWorkInput(input.routingWorkInput, input.taskDemand);
    assertValidOperationalOverlaySnapshot(input.operationalOverlay);
  } catch (error) {
    throw new RoutingWorkSnapshotValidationError(`Routing work snapshot contains invalid selector input: ${error instanceof Error ? error.message : "unreadable value"}`);
  }
  if (input.operationalOverlay.goalRef !== input.goalRef) throw new RoutingWorkSnapshotValidationError("Routing work snapshot overlay is bound to a different Goal");
  if (input.operationalOverlay.projectRef !== input.projectRef) throw new RoutingWorkSnapshotValidationError("Routing work snapshot overlay is bound to a different project");
  return deepFreezeClone({
    schemaVersion: ROUTING_WORK_SNAPSHOT_SCHEMA_VERSION,
    goalRef: input.goalRef,
    projectRef: input.projectRef,
    missionBundleRef: input.missionBundleRef,
    approvedModels,
    taskDemand: input.taskDemand,
    routingWorkInput: input.routingWorkInput,
    operationalOverlay: input.operationalOverlay,
  }) as RoutingWorkSnapshot;
}

export function assertValidRoutingWorkSnapshot(value: unknown): asserts value is RoutingWorkSnapshot {
  const record = strictProperties(value, ["schemaVersion", "goalRef", "projectRef", "missionBundleRef", "approvedModels", "taskDemand", "routingWorkInput", "operationalOverlay"], ["schemaVersion", "goalRef", "projectRef", "missionBundleRef", "approvedModels", "taskDemand", "routingWorkInput", "operationalOverlay"], "Routing work snapshot");
  if (record.schemaVersion !== ROUTING_WORK_SNAPSHOT_SCHEMA_VERSION) throw new RoutingWorkSnapshotValidationError("Routing work snapshot schemaVersion is invalid");
  const { schemaVersion: _schemaVersion, ...input } = record;
  validate(input as unknown as RoutingWorkSnapshotInput);
}

/** Build selector input only from explicit, Goal-bound durable snapshots. */
export function createRoutingWorkSnapshot(value: RoutingWorkSnapshotInput): RoutingWorkSnapshot {
  return validate(value);
}
