import { describe, expect, it } from "vitest";
import { createGitIntegrationService } from "./git-integration-service.js";

describe("worker Git integration lifecycle", () => {
  it("exposes one guarded operation that advances a worker commit into the Goal branch", () => {
    const service = createGitIntegrationService({
      pool: {} as never, withGoalLease: async (_goalId, operation) => operation({ goalId: "goal", ownerId: "owner", fencingToken: "1" }),
      createGitPort: () => ({} as never), getControlEpoch: async () => "1",
    });
    expect("advanceWorker" in service).toBe(true);
  });

  it("does not expose a raw integration-commit writer as an unguarded service operation", () => {
    const service = createGitIntegrationService({
      pool: {} as never, withGoalLease: async (_goalId, operation) => operation({ goalId: "goal", ownerId: "owner", fencingToken: "1" }),
      createGitPort: () => ({} as never), getControlEpoch: async () => "1",
    });
    expect("recordIntegrationCommit" in service).toBe(false);
  });
});
