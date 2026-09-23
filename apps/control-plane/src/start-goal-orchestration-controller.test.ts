import { describe, expect, it, vi } from "vitest";
import { createHeadActivationPlan, deriveHeadActivationCommandId } from "@maestro/domain";
import { createStartGoalOrchestrationController } from "./start-goal-orchestration-controller.js";

const commandBase = {
  eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  type: "start_goal" as const,
  projectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  goalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  taskContractId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  actorId: "operator-1",
  contentHash: "a".repeat(64),
};
const plan = createHeadActivationPlan({
  version: 1,
  departments: [
    {
      departmentId: "product",
      requestedContribution: "frame boundary",
      urgency: "normal",
      contextScope: ["task-contract"],
      budgetEffect: "none",
      reason: "explicit brief",
    },
  ],
});

describe("start-goal orchestration controller", () => {
  it("durably blocks a launched Goal when the Task Contract has no explicit Head plan", async () => {
    const begin = vi.fn(async () => ({ state: "running" as const }));
    const record = vi.fn(async () => undefined);
    const transitionGoal = vi.fn();
    const activate = vi.fn();
    const controller = createStartGoalOrchestrationController({
      begin,
      record,
      goalService: { getGoal: vi.fn(), transitionGoal },
      headParticipationService: { activate },
    } as never);

    await expect(controller.execute({ ...commandBase })).resolves.toMatchObject({
      state: "blocked",
      reason: "missing_head_activation_plan",
    });
    expect(begin).toHaveBeenCalledWith(undefined, expect.objectContaining({ headActivationPlanHash: null }), null);
    expect(record).toHaveBeenCalledWith(undefined, expect.objectContaining({ state: "blocked", reason: "missing_head_activation_plan" }));
    expect(transitionGoal).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("records unknown instead of completed when a Head reservation is not active", async () => {
    const begin = vi.fn(async () => ({ state: "running" as const }));
    const record = vi.fn(async () => undefined);
    const getGoal = vi.fn(async () => ({
      goalId: commandBase.goalId,
      projectId: commandBase.projectId,
      state: "active" as const,
      version: 4,
      contractId: commandBase.taskContractId,
    }));
    const activate = vi.fn(async () => ({
      goalId: commandBase.goalId,
      departmentId: "product",
      headRoleId: "head:product",
      contractId: commandBase.taskContractId,
      contextId: null,
      status: "starting" as const,
      activeSessionRef: null,
    }));
    const controller = createStartGoalOrchestrationController({
      begin,
      record,
      goalService: { getGoal, transitionGoal: vi.fn() },
      headParticipationService: { activate },
    } as never);

    await expect(controller.execute({ ...commandBase, headActivationPlan: plan })).resolves.toMatchObject({
      state: "unknown",
      reason: "head_activation_outcome_unknown",
    });
    expect(record).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ state: "unknown" }));
  });

  it("activates the explicit Head set after durably advancing draft -> active and replays stable command IDs", async () => {
    const begin = vi.fn(async () => ({ state: "running" as const }));
    const record = vi.fn(async (_pool: unknown, input: { state: string; reason: string }) => ({ ...input }));
    const getGoal = vi.fn(async () => ({
      goalId: commandBase.goalId,
      projectId: commandBase.projectId,
      state: "draft" as const,
      version: 1,
      contractId: commandBase.taskContractId,
    }));
    const transitionGoal = vi.fn(async (_goalId: string, input: { to: string; expectedVersion: number }) => ({
      goalId: commandBase.goalId,
      projectId: commandBase.projectId,
      state: input.to as never,
      version: input.expectedVersion + 1,
      contractId: commandBase.taskContractId,
    }));
    const activate = vi.fn(async () => ({
      goalId: commandBase.goalId,
      departmentId: "product",
      headRoleId: "head:product",
      contractId: commandBase.taskContractId,
      contextId: null,
      status: "active" as const,
      activeSessionRef: "opaque",
    }));
    const controller = createStartGoalOrchestrationController({
      begin,
      record,
      goalService: { getGoal, transitionGoal },
      headParticipationService: { activate },
      councilService: { create: vi.fn(async () => ({ councilId: "council-1" })) },
    } as never);

    await expect(controller.execute({ ...commandBase, headActivationPlan: plan })).resolves.toMatchObject({
      state: "completed",
      stage: "council_creation",
    });
    expect(begin).toHaveBeenCalledWith(undefined, expect.objectContaining({ headActivationPlanHash: plan.contentHash }), plan.contentHash);
    expect(transitionGoal).toHaveBeenCalledTimes(3);
    expect(transitionGoal.mock.calls.map((call) => call[1].to)).toEqual(["ready_for_confirmation", "launched", "active"]);
    expect(activate).toHaveBeenCalledWith(
      commandBase.goalId,
      expect.objectContaining({ projectId: commandBase.projectId, departmentId: "product", contractId: commandBase.taskContractId }),
      expect.objectContaining({ operatorId: "operator-1" }),
      deriveHeadActivationCommandId(commandBase.commandId, "product"),
    );
    expect(record).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ state: "completed", stage: "council_creation", reason: "council_created" }),
    );
  });
});
