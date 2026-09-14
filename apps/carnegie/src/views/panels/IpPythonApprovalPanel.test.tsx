import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectionNode } from "@maestro/contracts";
import { IpPythonApprovalPanel } from "./IpPythonApprovalPanel.js";
import type { IpPythonApprovalState, NodeActionsApi } from "../../lib/node-actions.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const node: ProjectionNode = { nodeId: goalId, kind: "goal", projectId, goalId, parentNodeId: null, sectorId: "goal", state: "active", version: 1, ownerId: null, crossLinks: [], sourceRevision: "1", eventCursor: "1", removed: false, sourceKey: [goalId] };
const state: IpPythonApprovalState = { sessionScope: "Goal", temporaryTools: ["ipython"], activeTier: "Department Head", pendingDecision: "Department Head review", userApprovalRequest: "Edit file", repetitionBudget: "2 executions", fullAccessMode: "skip_intermediate_approvals", externalCapabilities: [] };
const api = { pauseGoal: vi.fn(), resumeGoal: vi.fn(), stopGoal: vi.fn(), emergencyStopGoal: vi.fn(), requestCriticalAction: vi.fn(), approveAndRunCriticalAction: vi.fn(), selectFullAccessMode: vi.fn().mockResolvedValue({}) } as unknown as NodeActionsApi;

describe("IPython approval panel", () => {
  it("displays scope, tier, pending decision, repetition budget, and user requirement in skip mode", () => {
    const html = renderToStaticMarkup(<IpPythonApprovalPanel state={state} node={node} api={api} commandId={() => "44444444-4444-4444-8444-444444444444"} />);
    expect(html).toContain("Session scope");
    expect(html).toContain("Department Head review");
    expect(html).toContain("2 executions");
    expect(html).toContain("User tier");
    expect(html).toContain("Required for every full-access mode");
    expect(html).toContain("skip_intermediate_approvals");
  });
});
