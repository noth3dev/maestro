import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@maestro/api-client";
import { executeWriteCommand } from "./write-commands.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const goal = { goalId, projectId, state: "pausing" as const, version: 2 };

function api(): ApiClient {
  return {
    pauseGoal: vi.fn().mockResolvedValue(goal),
    emergencyStopGoal: vi.fn().mockResolvedValue({ ...goal, state: "stopped" as const }),
    createGoal: vi.fn().mockResolvedValue({ ...goal, state: "draft" as const }),
  } as unknown as ApiClient;
}

describe("TUI write commands", () => {
  it("passes stable command identity to a safe Goal mutation", async () => {
    const client = api();
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "goal", action: "pause", options: { "goal-id": goalId, "expected-version": "1", "command-id": commandId } });
    expect(client.pauseGoal).toHaveBeenCalledWith(goalId, { projectId, expectedVersion: 1 }, commandId);
  });

  it("does not call a critical API before approval, and cancellation makes no mutation", async () => {
    const client = api();
    const confirm = vi.fn().mockResolvedValue("cancelled" as const);
    await expect(executeWriteCommand({ client, projectId, confirm }, { name: "goal", action: "emergency-stop", options: { "goal-id": goalId, "expected-version": "1", "command-id": commandId } })).resolves.toEqual({ title: "Cancelled", lines: ["No mutation was sent."] });
    expect(confirm).toHaveBeenCalledOnce();
    expect(client.emergencyStopGoal).not.toHaveBeenCalled();
  });

  it("replays with the caller supplied command ID instead of replacing it", async () => {
    const client = api();
    const command = { name: "goal", action: "pause", options: { "goal-id": goalId, "expected-version": "1", "command-id": commandId } } as const;
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, command);
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, command);
    expect(vi.mocked(client.pauseGoal).mock.calls.map((call) => call[2])).toEqual([commandId, commandId]);
  });
});
