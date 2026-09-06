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
    createTaskContract: vi.fn(),
    raiseMetronomeChallenge: vi.fn(),
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

  it("routes Task Contract intake through the typed client", async () => {
    const client = api();
    vi.mocked(client.createTaskContract).mockResolvedValue({ contractId: "44444444-4444-4444-8444-444444444444", launchState: "awaiting_confirmation" } as never);
    const result = await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "task-contract", action: "create", options: { "contract-id": commandId, "substance-json": JSON.stringify({ desiredOutcome: "Ship" }) } });
    expect(result.title).toBe("Task Contract");
    expect(client.createTaskContract).toHaveBeenCalledWith({ projectId, substance: { desiredOutcome: "Ship" } }, expect.any(String));
  });

  it("accepts array JSON for Metronome challenge references", async () => {
    const client = api();
    vi.mocked(client.raiseMetronomeChallenge).mockResolvedValue({ challengeId: "44444444-4444-4444-8444-444444444444", status: "open" } as never);
    const result = await executeWriteCommand({ client, projectId, confirm: vi.fn() }, { name: "metronome", action: "challenge", options: { "goal-id": goalId, reason: "drift", "finding-ids": "[]", "evidence-references": "[]", "command-id": commandId } });
    expect(result.title).toBe("Metronome");
    expect(client.raiseMetronomeChallenge).toHaveBeenCalledWith(goalId, { projectId, reason: "drift", findingIds: [], evidenceReferences: [] }, commandId);
  });

  it("replays with the caller supplied command ID instead of replacing it", async () => {
    const client = api();
    const command = { name: "goal", action: "pause", options: { "goal-id": goalId, "expected-version": "1", "command-id": commandId } } as const;
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, command);
    await executeWriteCommand({ client, projectId, confirm: vi.fn() }, command);
    expect(vi.mocked(client.pauseGoal).mock.calls.map((call) => call[2])).toEqual([commandId, commandId]);
  });
});
