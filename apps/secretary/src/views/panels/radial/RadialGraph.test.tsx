import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectionReadModel } from "@maestro/contracts";
import { goalSelectionId, panViewport, RadialGraph } from "./RadialGraph.js";
import { buildRadialLayout } from "./radial-layout.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const projection: ProjectionReadModel = {
  eventCursor: "2",
  nodes: [
    { nodeId: goalId, kind: "goal", projectId, goalId, parentNodeId: null, sectorId: "goal", state: "active", version: 1, ownerId: null, crossLinks: [], sourceRevision: "1", eventCursor: "2", removed: false, sourceKey: [goalId] },
    { nodeId: "plan-engineering", kind: "department_plan", projectId, goalId, parentNodeId: goalId, sectorId: "engineering", state: "active", version: 1, ownerId: "eng-head", crossLinks: [], sourceRevision: "1", eventCursor: "2", removed: false, sourceKey: ["plan-engineering"] },
  ],
  edges: [],
};

describe("RadialGraph", () => {
  it("renders a projection-driven graph with a fixed Concertmaster center and keyboard controls", () => {
    const html = renderToStaticMarkup(<RadialGraph projection={projection} onBack={() => undefined} />);
    expect(html).toContain("Concertmaster");
    expect(html).toContain("Goal");
    expect(html).toContain("Task Contract");
    expect(html).toContain("data-radial-node-version=\"1\"");
    expect(html).toContain("engineering");
    expect(html).toContain("Search graph nodes");
    expect(html).toContain("Zoom in");
    expect(html).toContain("Pan left");
    expect(html).not.toContain("illustrative");
  });

  it("exposes a keyboard-safe viewport pan operation", () => {
    expect(panViewport({ x: 10, y: 20, zoom: 1 }, 80, 0)).toEqual({ x: 90, y: 20, zoom: 1 });
  });

  it("uses the projection goalId rather than assuming nodeId identity", () => {
    const goalNode = projection.nodes.find((entry) => entry.kind === "goal");
    const node = buildRadialLayout({ ...projection, nodes: [{ ...goalNode!, nodeId: "goal-node-key" }] }, { selectedGoalId: goalId }).nodes.find((entry) => entry.kind === "goal");
    expect(node).toBeDefined();
    expect(goalSelectionId(node!)).toBe(goalId);
  });

});
