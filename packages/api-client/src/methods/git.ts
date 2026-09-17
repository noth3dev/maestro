import {
  WorkerIntegrationInputSchema,
  IntegrationCommitSchema,
  GoalIntegrationBranchInputSchema,
  GoalIntegrationBranchSchema,
  GoalIntegrationRevisionSchema,
  DepartmentBranchSchema,
  DepartmentBranchInputSchema,
  WorkerWorktreeSchema,
  WorkerWorktreeInputSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createGitMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  | "createGoalIntegrationBranch"
  | "freezeGoalIntegrationRevision"
  | "createDepartmentBranch"
  | "createWorkerWorktree"
  | "advanceWorkerIntegration"
> {
  const { request, headers } = ctx;
  return {
    createGoalIntegrationBranch(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/git/integration-branch`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(GoalIntegrationBranchInputSchema.parse(input)),
        },
        GoalIntegrationBranchSchema,
      );
    },
    freezeGoalIntegrationRevision(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/git/integration-revision`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(DepartmentBranchInputSchema.parse(input)),
        },
        GoalIntegrationRevisionSchema,
      );
    },
    createDepartmentBranch(councilId, departmentId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/git/branch`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(DepartmentBranchInputSchema.parse(input)),
        },
        DepartmentBranchSchema,
      );
    },
    createWorkerWorktree(workerId, input, commandId) {
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/git/worktree`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(WorkerWorktreeInputSchema.parse(input)),
        },
        WorkerWorktreeSchema,
      );
    },
    advanceWorkerIntegration(workerId, input, commandId) {
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/git/advance`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(WorkerIntegrationInputSchema.parse(input)),
        },
        IntegrationCommitSchema,
      );
    },
  };
}
