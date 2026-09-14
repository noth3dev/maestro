import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectionNode } from "@maestro/contracts";
import type { NodeActionsApi } from "../../../lib/node-actions.js";
import { NodeActionControls } from "./NodeActionControls.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const node: ProjectionNode = { nodeId: goalId, kind: "goal", projectId, goalId, parentNodeId: null, sectorId: "goal", state: "active", version: 4, ownerId: null, crossLinks: [], sourceRevision: "4", eventCursor: "8", removed: false, sourceKey: [goalId] };
const api = { pauseGoal: vi.fn(), resumeGoal: vi.fn(), stopGoal: vi.fn(), emergencyStopGoal: vi.fn(), requestCriticalAction: vi.fn(), approveAndRunCriticalAction: vi.fn(), selectFullAccessMode: vi.fn() } as unknown as NodeActionsApi;

describe("selected radial node actions", () => {
  it("renders a server-derived unauthorized reason instead of hiding the control", () => {
    const html = renderToStaticMarkup(<NodeActionControls node={node} api={api} actor={{ kind: "user", authorized: false, reason: "Head approval required", decisionPath: "Request Head approval" }} />);
    expect(html).toContain("Head approval required");
    expect(html).toContain("Request Head approval");
  });

  it("renders exact critical confirmation fields only with the exact server input", () => {
    const html = renderToStaticMarkup(<NodeActionControls node={node} api={api} critical={{ action: "deploy", target: "production", goalId, expiresAt: "2026-01-01T00:00:00.000Z", expectedEffect: "Release", rollbackFeasibility: "rollback available" }} criticalInput={{ policyVersion: 3, budgetEffectCents: 12 }} />);
    expect(html).toContain("Critical action confirmation");
    expect(html).toContain("production");
    expect(html).toContain("rollback available");
    expect(html).toContain("2026-01-01T00:00:00.000Z");
  });

  it("renders the actual Goal control commands in the selected-node path", () => {
    const html = renderToStaticMarkup(<NodeActionControls node={node} api={api} />);
    expect(html).toContain("Pause Goal");
    expect(html).toContain("Resume Goal");
    expect(html).toContain("Stop Goal");
    expect(html).toContain("Emergency stop Goal");
  });
});
