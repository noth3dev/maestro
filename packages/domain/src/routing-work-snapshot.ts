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

function validate(value: RoutingWorkSnapshotInput): RoutingWorkSnapshot {
  line(value.goalRef, "Routing work snapshot goalRef");
  line(value.projectRef, "Routing work snapshot projectRef");
  line(value.missionBundleRef, "Routing work snapshot missionBundleRef");
  if (!Array.isArray(value.approvedModels) || value.approvedModels.length === 0) {
    throw new RoutingWorkSnapshotValidationError("Routing work snapshot approvedModels must be non-empty");
  }
  const approved = new Set<string>();
  for (const model of value.approvedModels) {
    modelRef(model, "Routing work snapshot approvedModels entry");
    if (approved.has(model)) throw new RoutingWorkSnapshotValidationError("Routing work snapshot approvedModels must not contain duplicates");
    approved.add(model);
  }
  try {
    assertValidTaskDemand(value.taskDemand);
    if (value.routingWorkInput === undefined) throw new Error("routingWorkInput is absent");
    assertValidRoutingWorkInput(value.routingWorkInput, value.taskDemand);
    assertValidOperationalOverlaySnapshot(value.operationalOverlay);
  } catch (error) {
    throw new RoutingWorkSnapshotValidationError(
      `Routing work snapshot contains invalid selector input: ${error instanceof Error ? error.message : "unreadable value"}`,
    );
  }
  if (value.operationalOverlay.goalRef !== value.goalRef) {
    throw new RoutingWorkSnapshotValidationError("Routing work snapshot overlay is bound to a different Goal");
  }
  if (value.operationalOverlay.projectRef !== value.projectRef) {
    throw new RoutingWorkSnapshotValidationError("Routing work snapshot overlay is bound to a different project");
  }
  return {
    schemaVersion: ROUTING_WORK_SNAPSHOT_SCHEMA_VERSION,
    goalRef: value.goalRef,
    projectRef: value.projectRef,
    missionBundleRef: value.missionBundleRef,
    approvedModels: Object.freeze([...value.approvedModels]),
    taskDemand: value.taskDemand,
    routingWorkInput: value.routingWorkInput,
    operationalOverlay: value.operationalOverlay,
  };
}

export function assertValidRoutingWorkSnapshot(value: unknown): asserts value is RoutingWorkSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoutingWorkSnapshotValidationError("Routing work snapshot must be an object");
  const record = value as Record<string, unknown>;
  const allowed = ["schemaVersion", "goalRef", "projectRef", "missionBundleRef", "approvedModels", "taskDemand", "routingWorkInput", "operationalOverlay"] as const;
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !allowed.includes(key as (typeof allowed)[number])) throw new RoutingWorkSnapshotValidationError(`Routing work snapshot has unknown field ${String(key)}`);
  }
  if (record.schemaVersion !== ROUTING_WORK_SNAPSHOT_SCHEMA_VERSION) throw new RoutingWorkSnapshotValidationError("Routing work snapshot schemaVersion is invalid");
  if (!Object.hasOwn(record, "routingWorkInput")) throw new RoutingWorkSnapshotValidationError("Routing work snapshot routingWorkInput is required");
  validate(record as unknown as RoutingWorkSnapshotInput);
}

/** Build selector input only from explicit, Goal-bound durable snapshots. */
export function createRoutingWorkSnapshot(value: RoutingWorkSnapshotInput): RoutingWorkSnapshot {
  return Object.freeze(validate(value));
}
