import { createRoutingWorkSnapshot, type RoutingWorkSnapshot } from "@maestro/domain";
import type { Pool } from "pg";
import { readHeadCouncil } from "./council.js";
import { readGoalOperationalOverlaySnapshot } from "./ensemble-router-artifacts.js";
import { readMissionBundle } from "./mission-bundle.js";

export class RoutingWorkSnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingWorkSnapshotUnavailableError";
  }
}

export interface ReadRoutingWorkSnapshotRequest {
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly itemId: string;
  readonly goalRef: string;
  readonly projectRef: string;
}

/**
 * Read the durable Mission Bundle and Goal-scoped C snapshot together.
 * Ensemble routing has no fallback when either half is absent or cross-bound.
 */
export async function readRoutingWorkSnapshot(pool: Pool, input: ReadRoutingWorkSnapshotRequest): Promise<RoutingWorkSnapshot> {
  const [bundle, overlay] = await Promise.all([
    readMissionBundle(pool, input.councilId, input.departmentId, input.planVersion, input.itemId),
    readGoalOperationalOverlaySnapshot(pool, input.goalRef),
  ]);
  if (overlay === null) throw new RoutingWorkSnapshotUnavailableError("Goal has no durable operational overlay snapshot");
  const council = await readHeadCouncil(pool, input.councilId);
  if (council.goalId !== input.goalRef || council.snapshot.projectId !== input.projectRef) {
    throw new RoutingWorkSnapshotUnavailableError("Routing work snapshot Goal/project binding is invalid");
  }
  if (overlay.goalRef !== input.goalRef || overlay.projectRef !== input.projectRef) {
    throw new RoutingWorkSnapshotUnavailableError("Goal operational overlay snapshot is outside the requested scope");
  }
  if (bundle.councilId !== input.councilId || bundle.departmentId !== input.departmentId || bundle.planVersion !== input.planVersion || bundle.itemId !== input.itemId) {
    throw new RoutingWorkSnapshotUnavailableError("Mission Bundle identity is outside the requested scope");
  }
  return createRoutingWorkSnapshot({
    goalRef: input.goalRef,
    projectRef: input.projectRef,
    missionBundleRef: bundle.contentHash,
    approvedModels: bundle.substance.approvedModels,
    taskDemand: bundle.substance.taskDemand,
    routingWorkInput: bundle.substance.routingWorkInput,
    operationalOverlay: overlay,
  });
}
