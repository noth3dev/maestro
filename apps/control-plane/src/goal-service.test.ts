import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  acquireGoalLease: vi.fn(),
  renewGoalLease: vi.fn(),
  executeGoalCommand: vi.fn(),
  assertProjectRole: vi.fn(),
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


describe("durable goal service lease-proof retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retains the lease proof after a terminal Goal state so retries can replay receipts", async () => {
    persistence.acquireGoalLease.mockResolvedValue(proof);
    persistence.executeGoalCommand.mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "succeeded", version: 1 });
    const service = createDurableGoalService({ pool: {} as never, actorId: "operator-A", leaseOwnerId: "instance-A" });

    await service.createGoal({ projectId }, commandId, operator);
    expect(persistence.acquireGoalLease).toHaveBeenCalledTimes(1);
    expect(persistence.renewGoalLease).not.toHaveBeenCalled();

    persistence.executeGoalCommand.mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "succeeded", version: 2 });
    await service.transitionGoal(commandId, { projectId, expectedVersion: 1, to: "succeeded" }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", operator);

    expect(persistence.acquireGoalLease).toHaveBeenCalledTimes(1);
    expect(persistence.renewGoalLease).toHaveBeenCalledTimes(1);
  });

  it("retains the lease proof and still renews on retry when the command result is nonterminal", async () => {
    persistence.acquireGoalLease.mockResolvedValue(proof);
    persistence.renewGoalLease.mockResolvedValue(proof);
    persistence.executeGoalCommand.mockResolvedValue({ outcome: "succeeded", goalId: proof.goalId, state: "draft", version: 1 });
    const service = createDurableGoalService({ pool: {} as never, actorId: "operator-A", leaseOwnerId: "instance-A" });

    await service.createGoal({ projectId }, commandId, operator);
    await service.transitionGoal(commandId, { projectId, expectedVersion: 1, to: "ready_for_confirmation" }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06", operator);

    expect(persistence.acquireGoalLease).toHaveBeenCalledTimes(1);
    expect(persistence.renewGoalLease).toHaveBeenCalledTimes(1);
  });

  it("retains the lease proof (still renews on the next call) when a command result is a version conflict, not a terminal success", async () => {
    persistence.acquireGoalLease.mockResolvedValue(proof);
    persistence.renewGoalLease.mockResolvedValue(proof);
    persistence.executeGoalCommand
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "draft", version: 1 })
      .mockResolvedValueOnce({ outcome: "version_conflict" });
    const service = createDurableGoalService({ pool: {} as never, actorId: "operator-A", leaseOwnerId: "instance-A" });

    await service.createGoal({ projectId }, commandId, operator);
    await expect(
      service.transitionGoal(commandId, { projectId, expectedVersion: 5, to: "ready_for_confirmation" }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f07", operator),
    ).rejects.toMatchObject({ name: "VersionConflictError" });

    persistence.executeGoalCommand.mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "ready_for_confirmation", version: 2 });
    await service.transitionGoal(commandId, { projectId, expectedVersion: 1, to: "ready_for_confirmation" }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f08", operator);

    expect(persistence.acquireGoalLease).toHaveBeenCalledTimes(1);
    expect(persistence.renewGoalLease).toHaveBeenCalledTimes(2);
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


describe("durable goal service control operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses narrow idempotent lifecycle commands for pause, stop, resume, and emergency stop", async () => {
    persistence.acquireGoalLease.mockResolvedValue(proof);
    persistence.executeGoalCommand
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "pausing", version: 2 })
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "stopping", version: 3 })
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "resuming", version: 4 })
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "stopped", version: 5 });
    const service = createDurableGoalService({ pool: {} as never, actorId: "operator-A", leaseOwnerId: "instance-A" });

    await service.pauseGoal(proof.goalId, { projectId, expectedVersion: 1 }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", operator);
    await service.stopGoal(proof.goalId, { projectId, expectedVersion: 2 }, "018f3c9b-7e71-7b44-ae23-3b5d4e8f9f04", operator);
    await service.resumeGoal(proof.goalId, { projectId, expectedVersion: 3 }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", operator);
    await service.emergencyStopGoal(proof.goalId, { projectId, expectedVersion: 4 }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06", operator);

    expect(persistence.executeGoalCommand).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ type: "TransitionGoal", to: "pausing", requiredRole: "concertmaster", actorId: operator.operatorId }), proof);
    expect(persistence.executeGoalCommand).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ type: "TransitionGoal", to: "stopping", requiredRole: "concertmaster" }), proof);
    expect(persistence.executeGoalCommand).toHaveBeenNthCalledWith(3, {}, expect.objectContaining({ type: "TransitionGoal", to: "resuming", requiredRole: "concertmaster" }), proof);
    expect(persistence.executeGoalCommand).toHaveBeenNthCalledWith(4, {}, expect.objectContaining({ type: "EmergencyStopGoal", requiredRole: "concertmaster" }), proof);
  });


  it("retains the terminal lease proof so a lost response can replay the same idempotent command", async () => {
    persistence.acquireGoalLease.mockResolvedValue(proof);
    persistence.renewGoalLease.mockResolvedValue(proof);
    persistence.executeGoalCommand
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "stopped", version: 2 })
      .mockResolvedValueOnce({ outcome: "succeeded", goalId: proof.goalId, state: "stopped", version: 2 });
    const service = createDurableGoalService({ pool: {} as never, actorId: "operator-A", leaseOwnerId: "instance-A" });

    await service.emergencyStopGoal(proof.goalId, { projectId, expectedVersion: 1 }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", operator);
    await expect(service.emergencyStopGoal(proof.goalId, { projectId, expectedVersion: 1 }, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", operator)).resolves.toMatchObject({ state: "stopped", version: 2 });

    expect(persistence.acquireGoalLease).toHaveBeenCalledTimes(1);
    expect(persistence.renewGoalLease).toHaveBeenCalledTimes(1);
  });

});
