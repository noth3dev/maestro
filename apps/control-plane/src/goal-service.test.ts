import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  acquireGoalLease: vi.fn(),
  renewGoalLease: vi.fn(),
  executeGoalCommand: vi.fn(),
}));

vi.mock("@maestro/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@maestro/persistence")>()),
  ...persistence,
}));

import { CommandIdReuseError } from "@maestro/persistence";
import { createDurableGoalService } from "./goal-service.js";

const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const commandId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03";
const proof = { goalId: commandId, ownerId: "instance-A", fencingToken: "1" };
const operator = { operatorId: "operator-from-request", credentialId: "credential-from-request" };

describe("durable goal service leases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renews its matching lease proof before an immediate transition", async () => {
    persistence.acquireGoalLease.mockResolvedValue(proof);
    persistence.renewGoalLease.mockResolvedValue(proof);
    persistence.executeGoalCommand
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "draft", version: 1 })
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "ready_for_confirmation", version: 2 });
    const service = createDurableGoalService({ pool: {} as never, actorId: "operator-A", leaseOwnerId: "instance-A" });

    const created = await service.createGoal({ projectId }, commandId, operator);
    await service.transitionGoal(created.goalId, { projectId, expectedVersion: 1, to: "ready_for_confirmation" }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", operator);

    expect(persistence.acquireGoalLease).toHaveBeenCalledTimes(1);
    expect(persistence.renewGoalLease).toHaveBeenCalledWith({}, proof, 30_000);
    expect(persistence.executeGoalCommand).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ commandId, actorId: operator.operatorId }), proof);
    expect(persistence.executeGoalCommand).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ commandId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04" }), proof);
  });

  it("uses the create command ID as a stable goal ID for durable retries", async () => {
    persistence.acquireGoalLease.mockResolvedValue(proof);
    persistence.renewGoalLease.mockResolvedValue(proof);
    persistence.executeGoalCommand.mockResolvedValue({ outcome: "succeeded", goalId: commandId, state: "draft", version: 1 });
    const service = createDurableGoalService({ pool: {} as never, actorId: "operator-A", leaseOwnerId: "instance-A" });

    await service.createGoal({ projectId }, commandId, operator);
    await service.createGoal({ projectId }, commandId, operator);

    expect(persistence.executeGoalCommand).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ commandId, goalId: commandId }), expect.anything());
    expect(persistence.executeGoalCommand).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ commandId, goalId: commandId }), expect.anything());
  });
});


describe("durable goal service command receipt errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves a reused command ID as a typed service error", async () => {
    persistence.acquireGoalLease.mockResolvedValue(proof);
    persistence.executeGoalCommand.mockRejectedValue(new CommandIdReuseError(commandId));
    const service = createDurableGoalService({ pool: {} as never, actorId: "operator-A", leaseOwnerId: "instance-A" });

    await expect(service.createGoal({ projectId }, commandId, operator)).rejects.toMatchObject({ name: "CommandIdReuseError" });
  });
});
