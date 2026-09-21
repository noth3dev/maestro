import type { ApiClient, WorkerList } from "@maestro/api-client";
import { MissionBundleSchema, type MissionBundle, type Worker, type WorkerObservation } from "@maestro/contracts";
import { newCommandId } from "./command-id.js";

/** API surface used by the contextual Worker detail/operations surface. */
export type WorkerApi = Pick<
  ApiClient,
  | "spawnWorker"
  | "getWorker"
  | "observeWorker"
  | "sendWorkerMessage"
  | "cancelWorker"
  | "listWorkersForGoal"
  | "createWorkerWorktree"
>;

export async function loadWorkers(api: WorkerApi, goalId: string, projectId: string): Promise<WorkerList> {
  return api.listWorkersForGoal(goalId, { projectId });
}

/**
 * Worker admission is intentionally bundle-shaped. The renderer cannot provide a council,
 * department, plan version, or item independently of the durable Mission Bundle.
 */
export async function spawnWorkerFromMissionBundle(
  api: Pick<WorkerApi, "spawnWorker">,
  projectId: string,
  bundle: MissionBundle,
  commandId = newCommandId(),
): Promise<Worker> {
  const parsedBundle = MissionBundleSchema.parse(bundle);
  return api.spawnWorker(
    parsedBundle.councilId,
    parsedBundle.departmentId,
    { projectId, planVersion: parsedBundle.planVersion, itemId: parsedBundle.itemId },
    commandId,
  );
}


export function missionBundleMatchesWorker(bundle: MissionBundle, worker: Pick<Worker, "councilId" | "departmentId" | "planVersion" | "itemId" | "bundleContentHash">): boolean {
  return bundle.councilId === worker.councilId
    && bundle.departmentId === worker.departmentId
    && bundle.planVersion === worker.planVersion
    && bundle.itemId === worker.itemId
    && bundle.contentHash === worker.bundleContentHash;
}

export async function loadWorker(api: Pick<WorkerApi, "getWorker">, workerId: string, projectId: string): Promise<Worker> {
  return api.getWorker(workerId, projectId);
}

/** Reads the current Worker before recording an observation, so a stale selection cannot silently act on another Worker. */
type ScopedWorkerApi = Pick<WorkerApi, "listWorkersForGoal" | "getWorker">;

export type WorkerActionScope = {
  readonly goalId: string;
  readonly projectId: string;
  readonly bundle: MissionBundle;
};

async function loadScopedWorker(api: ScopedWorkerApi, workerId: string, scope: WorkerActionScope): Promise<Worker> {
  const bundle = MissionBundleSchema.parse(scope.bundle);
  const listed = (await api.listWorkersForGoal(scope.goalId, { projectId: scope.projectId })).workers.find((worker) => worker.workerId === workerId);
  if (listed === undefined || !missionBundleMatchesWorker(bundle, listed)) throw new Error("Worker is no longer in the selected Goal or Mission Bundle scope");
  const current = await api.getWorker(workerId, scope.projectId);
  if (!missionBundleMatchesWorker(bundle, current)) throw new Error("Worker identity no longer matches the Mission Bundle");
  return current;
}

export async function loadWorkerObservation(
  api: Pick<WorkerApi, "listWorkersForGoal" | "getWorker" | "observeWorker">,
  workerId: string,
  scope: WorkerActionScope,
  commandId = newCommandId(),
): Promise<WorkerObservation> {
  await loadScopedWorker(api, workerId, scope);
  return api.observeWorker(workerId, { projectId: scope.projectId }, commandId);
}

export async function sendWorkerMessage(
  api: Pick<WorkerApi, "listWorkersForGoal" | "getWorker" | "sendWorkerMessage">,
  workerId: string,
  scope: WorkerActionScope,
  message: string,
  commandId = newCommandId(),
): Promise<Worker> {
  const content = message.trim();
  if (content === "") throw new Error("Worker message cannot be empty");
  await loadScopedWorker(api, workerId, scope);
  return api.sendWorkerMessage(workerId, { projectId: scope.projectId, message: content }, commandId);
}

const TERMINAL_WORKER_STATUSES = new Set<Worker["status"]>(["succeeded", "failed", "cancelled", "unknown"]);

export async function cancelWorkerAfterConfirmation(
  api: Pick<WorkerApi, "listWorkersForGoal" | "getWorker" | "cancelWorker">,
  workerId: string,
  scope: WorkerActionScope,
  confirmed: boolean,
  commandId = newCommandId(),
): Promise<Worker> {
  if (!confirmed) throw new Error("Worker cancellation requires explicit confirmation");
  const current = await loadScopedWorker(api, workerId, scope);
  if (TERMINAL_WORKER_STATUSES.has(current.status)) throw new Error("Cannot cancel a terminal Worker");
  return api.cancelWorker(workerId, { projectId: scope.projectId }, commandId);
}
