import { describe, expect, it, vi } from "vitest";
import { loadGoalsAfterLaunch, selectGoalAfterLaunch, selectedGoalIdAfterRefresh } from "./goal-operations.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const firstGoal = { goalId: "22222222-2222-4222-8222-222222222222", projectId, state: "active" as const, version: 3 };
const secondGoal = { goalId: "33333333-3333-4333-8333-333333333333", projectId, state: "paused" as const, version: 4 };

describe("Goal loading and selection", () => {
  it("loads the durable project Goal list for initial selection", async () => {
    const listGoals = vi.fn().mockResolvedValue({ goals: [firstGoal, secondGoal] });

    await expect(loadGoalsAfterLaunch({ listGoals }, { projectId })).resolves.toEqual({ goals: [firstGoal, secondGoal] });
    expect(listGoals).toHaveBeenCalledWith(projectId);
    expect(selectedGoalIdAfterRefresh(undefined, [firstGoal, secondGoal])).toBe(firstGoal.goalId);
  });

  it("refreshes and selects the server-created Goal after Launch", async () => {
    const refreshGoals = vi.fn().mockResolvedValue({ goals: [firstGoal, secondGoal] });
    const selectGoal = vi.fn();

    await expect(selectGoalAfterLaunch({ refreshGoals }, { goalId: secondGoal.goalId }, selectGoal)).resolves.toBe(true);
    expect(refreshGoals).toHaveBeenCalledOnce();
    expect(selectGoal).toHaveBeenCalledWith(secondGoal.goalId);
  });

  it("does not select a Goal missing from the refreshed server list", async () => {
    const refreshGoals = vi.fn().mockResolvedValue({ goals: [firstGoal] });
    const selectGoal = vi.fn();

    await expect(selectGoalAfterLaunch({ refreshGoals }, { goalId: secondGoal.goalId }, selectGoal)).resolves.toBe(false);
    expect(selectGoal).not.toHaveBeenCalled();
  });

  it("does not select when the Goal refresh has no server result", async () => {
    const refreshGoals = vi.fn().mockResolvedValue(undefined);
    const selectGoal = vi.fn();

    await expect(selectGoalAfterLaunch({ refreshGoals }, { goalId: secondGoal.goalId }, selectGoal)).resolves.toBe(false);
    expect(selectGoal).not.toHaveBeenCalled();
  });

  it("keeps an explicit selected Goal while it remains in the refreshed list", () => {
    expect(selectedGoalIdAfterRefresh(secondGoal.goalId, [firstGoal, secondGoal])).toBe(secondGoal.goalId);
  });

  it("moves selection when the selected Goal disappears", () => {
    expect(selectedGoalIdAfterRefresh(secondGoal.goalId, [firstGoal])).toBe(firstGoal.goalId);
    expect(selectedGoalIdAfterRefresh(firstGoal.goalId, [])).toBeUndefined();
  });

  it("reloads the durable list after a refresh or reconnect", async () => {
    const listGoals = vi.fn()
      .mockResolvedValueOnce({ goals: [firstGoal] })
      .mockResolvedValueOnce({ goals: [firstGoal, secondGoal] });
    const api = { listGoals };

    await loadGoalsAfterLaunch(api, { projectId });
    await loadGoalsAfterLaunch(api, { projectId });

    expect(listGoals).toHaveBeenNthCalledWith(1, projectId);
    expect(listGoals).toHaveBeenNthCalledWith(2, projectId);
    expect(selectedGoalIdAfterRefresh(firstGoal.goalId, [firstGoal, secondGoal])).toBe(firstGoal.goalId);
  });
});
