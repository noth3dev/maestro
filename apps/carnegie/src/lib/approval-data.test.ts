import { describe, expect, it, vi } from "vitest";
import { groupInboxItems, requestCriticalAction, selectFullAccessMode } from "./approval-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const item = { decisionId: "33333333-3333-4333-8333-333333333333", commandId: "44444444-4444-4444-8444-444444444444", projectId, goalId, actorId: "operator-1", action: "deployment.release", target: "production", policyVersion: 1, budgetEffectCents: 0, classification: "critical" as const, reason: "critical_action", decidedAt: "2025-01-01T00:00:00.000Z" };

describe("approval data", () => {
  it("groups server inbox approvals without inventing worker or discussion state", () => {
    const groups = groupInboxItems([item]);
    expect(groups.criticalActions).toEqual([item]);
    expect(groups.workerDecisions).toEqual([]);
    expect(groups.discussions).toEqual([]);
  });

  it("routes a critical-action request through the existing Goal-scoped server method", async () => {
    const requestCriticalActionMock = vi.fn(async () => ({ goalId, effect: "allow" as const, reason: "ordinary", classification: "ordinary" as const }));
    await requestCriticalAction({ requestCriticalAction: requestCriticalActionMock }, { goalId, projectId, action: "git.branch.create", target: "feature/test", policyVersion: 2, budgetEffectCents: 0 }, "55555555-5555-4555-8555-555555555555");
    expect(requestCriticalActionMock).toHaveBeenCalledWith(goalId, { projectId, action: "git.branch.create", target: "feature/test", policyVersion: 2, budgetEffectCents: 0 }, "55555555-5555-4555-8555-555555555555");
  });

  it("requires explicit confirmation and keeps full-access inactive until the server returns a session", async () => {
    const select = vi.fn(async () => ({ sessionId: "66666666-6666-4666-8666-666666666666", capabilityKind: "ipython", projectId, goalId, fullAccessMode: "skip_intermediate_approvals" as const, selectedBy: "operator-1", selectedAt: "2025-01-01T00:00:00.000Z" }));
    const input = { goalId, projectId, capabilityKind: "ipython", sessionId: "66666666-6666-4666-8666-666666666666", fullAccessMode: "skip_intermediate_approvals" as const };
    await expect(selectFullAccessMode({ selectFullAccessMode: select }, input, false)).rejects.toThrow("explicit confirmation");
    expect(select).not.toHaveBeenCalled();
    await expect(selectFullAccessMode({ selectFullAccessMode: select }, input, true)).resolves.toMatchObject({ fullAccessMode: "skip_intermediate_approvals" });
    expect(select).toHaveBeenCalledWith(goalId, { projectId, capabilityKind: "ipython", sessionId: input.sessionId, fullAccessMode: input.fullAccessMode });
  });
});
