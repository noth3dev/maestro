import { describe, expect, it, vi } from "vitest";
import type { GoalIntegrationRevision } from "@maestro/contracts";
import {
  advanceWorkerIntegrationFromRevision,
  createGoalIntegrationBranch,
  createWorkerWorktree,
  type IntegrationApi,
} from "./integration-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";
const revision: GoalIntegrationRevision = {
  revisionId: "55555555-5555-4555-8555-555555555555",
  revisionNumber: 3,
  goalId,
  repositoryPath: "/repo/product",
  branchName: "maestro/goal/hero",
  baseRevision: "a".repeat(40),
  commitSha: "b".repeat(40),
};

function fakeApi(overrides: Partial<IntegrationApi> = {}): IntegrationApi {
  return {
    createGoalIntegrationBranch: vi.fn().mockResolvedValue({ goalId, repositoryPath: "/repo/product", branchName: "maestro/goal/hero", baseRevision: "a".repeat(40) }),
    createWorkerWorktree: vi.fn().mockResolvedValue({ workerId, repositoryPath: "/repo/product", worktreePath: "/tmp/worker", branchName: "maestro/worker/hero", baseBranchName: "maestro/goal/hero" }),
    advanceWorkerIntegration: vi.fn().mockResolvedValue({ workerId, commitSha: "c".repeat(40), message: "integrated", evidenceReferences: ["evidence-1"] }),
    ...overrides,
  };
}

describe("Git integration identity", () => {
  it("creates the Goal branch with the selected Goal and trusted project scope", async () => {
    const api = fakeApi();
    await createGoalIntegrationBranch(api, goalId, { projectId, repositoryPath: "/repo/product", branchName: "maestro/goal/hero", baseRevision: "a".repeat(40) }, commandId);
    expect(api.createGoalIntegrationBranch).toHaveBeenCalledWith(goalId, { projectId, repositoryPath: "/repo/product", branchName: "maestro/goal/hero", baseRevision: "a".repeat(40) }, commandId);
  });

  it("creates a Worker worktree using the real Worker identity", async () => {
    const api = fakeApi();
    await createWorkerWorktree(api, workerId, { projectId, worktreePath: "/tmp/worker", repositoryPath: "/repo/product" }, commandId);
    expect(api.createWorkerWorktree).toHaveBeenCalledWith(workerId, { projectId, worktreePath: "/tmp/worker", repositoryPath: "/repo/product" }, commandId);
  });

  it("refuses to advance integration without the server's current revision", async () => {
    const api = fakeApi();
    await expect(advanceWorkerIntegrationFromRevision(api, workerId, projectId, undefined, { message: "integrate", evidenceReferences: ["evidence-1"] }, commandId)).rejects.toThrow("current integration revision");
    expect(api.advanceWorkerIntegration).not.toHaveBeenCalled();
    await advanceWorkerIntegrationFromRevision(api, workerId, projectId, revision, { message: "integrate", evidenceReferences: ["evidence-1"] }, commandId);
    expect(api.advanceWorkerIntegration).toHaveBeenCalledWith(workerId, { projectId, message: "integrate", evidenceReferences: ["evidence-1"] }, commandId);
  });
});
