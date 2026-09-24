import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({ readStartGoalOrchestration: vi.fn() }));
vi.mock("@maestro/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@maestro/persistence")>()),
  ...persistence,
}));

import { readStartGoalOrchestration } from "@maestro/persistence";
import {
  createStartGoalOrchestrationStatusService,
  StartGoalOrchestrationStatusNotFoundError,
} from "./start-goal-orchestration-status-service.js";

const goalId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02";
const run = {
  goalId,
  projectId,
  taskContractId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03",
  startCommandId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04",
  actorId: "operator-1",
  stage: "briefs_pending" as const,
  state: "running" as const,
  headActivationPlanHash: "a".repeat(64),
  reason: "council_created",
};

describe("start-goal orchestration status service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the exact project-bound durable run without mutation", async () => {
    persistence.readStartGoalOrchestration.mockResolvedValue(run);
    const pool = { query: vi.fn() };
    await expect(createStartGoalOrchestrationStatusService({ pool: pool as never }).get(goalId, projectId)).resolves.toEqual(run);
    expect(readStartGoalOrchestration).toHaveBeenCalledWith(pool, goalId);
  });

  it("fails closed for missing or different-project runs", async () => {
    const pool = { query: vi.fn() };
    const service = createStartGoalOrchestrationStatusService({ pool: pool as never });
    persistence.readStartGoalOrchestration.mockResolvedValueOnce(undefined);
    await expect(service.get(goalId, projectId)).rejects.toThrow(StartGoalOrchestrationStatusNotFoundError);
    persistence.readStartGoalOrchestration.mockResolvedValueOnce({ ...run, projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f99" });
    await expect(service.get(goalId, projectId)).rejects.toThrow(StartGoalOrchestrationStatusNotFoundError);
  });
});
