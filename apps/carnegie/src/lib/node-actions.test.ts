import { describe, expect, it, vi } from "vitest";
import type { ProjectionNode } from "@maestro/contracts";
import { buildNodeActions, runNodeAction, type NodeActionsApi } from "./node-actions.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const node: ProjectionNode = { nodeId: goalId, kind: "goal", projectId, goalId, parentNodeId: null, sectorId: "goal", state: "active", version: 4, ownerId: null, crossLinks: [], sourceRevision: "4", eventCursor: "8", removed: false, sourceKey: [goalId] };

function api(): NodeActionsApi {
  return {
    pauseGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "pausing", version: 5 }),
    resumeGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "resuming", version: 5 }),
    stopGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "stopping", version: 5 }),
    emergencyStopGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "emergency_stopped", version: 5 }),
    requestCriticalAction: vi.fn().mockResolvedValue({ goalId, effect: "allow", reason: "approved", classification: "critical", recordId: commandId }),
    approveAndRunCriticalAction: vi.fn().mockResolvedValue({ goalId, effect: "allow", reason: "approved", classification: "critical", recordId: commandId }),
    selectFullAccessMode: vi.fn().mockResolvedValue({ sessionId: commandId, capabilityKind: "ipython", projectId, goalId, fullAccessMode: "skip_intermediate_approvals", selectedBy: "operator", selectedAt: "2026-01-01T00:00:00.000Z" }),
  };
}

describe("Carnegie node actions", () => {
  it("maps each offered action to one exact server command", () => {
    const actions = buildNodeActions(node, { actor: { kind: "user", authorized: true } });
    expect(actions.map((action) => action.command)).toEqual(["pauseGoal", "resumeGoal", "stopGoal", "emergencyStopGoal"]);
    expect(new Set(actions.map((action) => action.command)).size).toBe(actions.length);
  });

  it("executes one selected control through one server command", async () => {
    const client = api();
    await runNodeAction(client, { kind: "command", command: "pauseGoal", node }, commandId);
    expect(client.pauseGoal).toHaveBeenCalledOnce();
    expect(client.resumeGoal).not.toHaveBeenCalled();
    expect(client.pauseGoal).toHaveBeenCalledWith(goalId, { projectId, expectedVersion: 4 }, commandId);
  });

  it("surfaces a server rejection without converting it into a different action", async () => {
    const client = api();
    vi.mocked(client.pauseGoal).mockRejectedValueOnce(new Error("authority denied"));
    await expect(runNodeAction(client, { kind: "command", command: "pauseGoal", node }, commandId)).rejects.toThrow("authority denied");
    expect(client.resumeGoal).not.toHaveBeenCalled();
  });

  it("deduplicates repeated controls while preserving their order", () => {
    const actions = buildNodeActions(node, { controls: ["pauseGoal", "pauseGoal", "stopGoal"], actor: { kind: "user", authorized: true } });
    expect(actions.map((action) => action.command)).toEqual(["pauseGoal", "stopGoal"]);
  });

  it("carries the exact policy and budget input into the critical command", async () => {
    const client = api();
    await runNodeAction(client, { kind: "critical", command: "requestCriticalAction", node, critical: { action: "deploy", target: "staging", goalId, expiresAt: "2026-01-01T00:00:00.000Z", expectedEffect: "Release", rollbackFeasibility: "feasible" }, criticalInput: { projectId, policyVersion: 7, budgetEffectCents: 41 } }, commandId);
    expect(client.requestCriticalAction).toHaveBeenCalledWith(goalId, { projectId, action: "deploy", target: "staging", policyVersion: 7, budgetEffectCents: 41 }, commandId);
  });

  it("preserves the exact critical confirmation fields", () => {
    expect(buildNodeActions(node, { actor: { kind: "user", authorized: true }, critical: { action: "deploy", target: "production", goalId, expiresAt: "2026-01-01T00:00:00.000Z", expectedEffect: "Release build", rollbackFeasibility: "rollback available" } }).find((action) => action.kind === "critical")?.confirmation).toEqual({ action: "deploy", target: "production", goalId, expiresAt: "2026-01-01T00:00:00.000Z", expectedEffect: "Release build", rollbackFeasibility: "rollback available" });
  });

  it("keeps unauthorized controls visible with the reason and decision path", () => {
    const unauthorized = buildNodeActions(node, { actor: { kind: "user", authorized: false, reason: "Department Head approval required", decisionPath: "request Department Head approval" } });
    expect(unauthorized.some((action) => action.kind === "unauthorized" && action.reason === "Department Head approval required" && action.decisionPath === "request Department Head approval")).toBe(true);
  });

  it("does not offer forbidden actions or downgrade a decline", () => {
    expect(buildNodeActions(node, { actor: { kind: "user", authorized: true }, critical: { action: "deploy", target: "production", goalId, expiresAt: "2026-01-01T00:00:00.000Z", expectedEffect: "Release", rollbackFeasibility: "not feasible", classification: "forbidden" } }).some((action) => action.kind === "critical")).toBe(false);
    expect(() => runNodeAction(api(), { kind: "critical", command: "approveAndRunCriticalAction", node, critical: { action: "deploy", target: "production", goalId, expiresAt: "2026-01-01T00:00:00.000Z", expectedEffect: "Release", rollbackFeasibility: "not feasible", classification: "forbidden" } }, commandId)).toThrow("forbidden");
    expect(buildNodeActions(node, { actor: { kind: "user", authorized: true }, critical: { action: "deploy", target: "production", goalId, expiresAt: "2026-01-01T00:00:00.000Z", expectedEffect: "Release", rollbackFeasibility: "not feasible", decision: "declined" } }).some((action) => action.kind === "critical")).toBe(false);
  });

  it("keeps user tier visible and required when skipping intermediate approvals", () => {
    const state = { sessionScope: "Goal", activeTier: "Department Head" as const, pendingDecision: "pending", repetitionBudget: "one_execution", fullAccessMode: "skip_intermediate_approvals" as const, userTierRequired: true };
    expect(state.userTierRequired).toBe(true);
  });
});
