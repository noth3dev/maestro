import { describe, expect, it, vi } from "vitest";
import { runGoalControlAction, type GoalControlApi } from "./goal-control.js";

const goalId = "22222222-2222-4222-8222-222222222222";
const projectId = "11111111-1111-4111-8111-111111111111";
const commandId = "44444444-4444-4444-8444-444444444444";

function fakeApi(): GoalControlApi {
  return {
    pauseGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "paused", version: 8 }),
    resumeGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "active", version: 8 }),
    stopGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "stopped", version: 8 }),
    emergencyStopGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "emergency_stopped", version: 8 }),
  };
}

describe("runGoalControlAction", () => {
  it.each([
    ["pause", "pauseGoal"],
    ["resume", "resumeGoal"],
    ["stop", "stopGoal"],
    ["emergency-stop", "emergencyStopGoal"],
  ] as const)("calls %s through the bridged API with the caller's exact expected version", async (action, method) => {
    const api = fakeApi();
    const result = await runGoalControlAction(api, { goalId, projectId, action, expectedVersion: 7 }, commandId);
    expect(api[method]).toHaveBeenCalledWith(goalId, { projectId, expectedVersion: 7 }, commandId);
    expect(result.version).toBe(8);
  });

  it("generates a fresh command id when the caller does not supply one", async () => {
    const api = fakeApi();
    await runGoalControlAction(api, { goalId, projectId, action: "pause", expectedVersion: 1 });
    const [, , usedCommandId] = (api.pauseGoal as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown, string];
    expect(usedCommandId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
