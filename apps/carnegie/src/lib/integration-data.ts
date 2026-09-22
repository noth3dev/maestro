import type {
  GoalIntegrationBranchInput,
  GoalIntegrationRevision,
  WorkerIntegrationInput,
  WorkerWorktreeInput,
} from "@maestro/contracts";
import type { ApiClient } from "@maestro/api-client";

export type IntegrationApi = Pick<ApiClient, "createGoalIntegrationBranch" | "createWorkerWorktree" | "advanceWorkerIntegration">;

export function createGoalIntegrationBranch(
  api: Pick<IntegrationApi, "createGoalIntegrationBranch">,
  goalId: string,
  input: GoalIntegrationBranchInput,
  commandId: string,
) {
  return api.createGoalIntegrationBranch(goalId, input, commandId);
}

export function createWorkerWorktree(
  api: Pick<IntegrationApi, "createWorkerWorktree">,
  workerId: string,
  input: WorkerWorktreeInput,
  commandId: string,
) {
  return api.createWorkerWorktree(workerId, input, commandId);
}

export async function advanceWorkerIntegrationFromRevision(
  api: Pick<IntegrationApi, "advanceWorkerIntegration">,
  workerId: string,
  projectId: string,
  currentRevision: GoalIntegrationRevision | null | undefined,
  input: Omit<WorkerIntegrationInput, "projectId">,
  commandId: string,
) {
  if (currentRevision === null || currentRevision === undefined) throw new Error("A current integration revision is required");
  return api.advanceWorkerIntegration(workerId, { projectId, ...input }, commandId);
}
