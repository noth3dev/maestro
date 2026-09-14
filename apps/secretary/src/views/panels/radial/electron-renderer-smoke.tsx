import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { ProjectionReadModel } from "@maestro/contracts";
import { RadialGraph } from "./RadialGraph.js";

const goalId = "22222222-2222-4222-8222-222222222222";
const projectId = "11111111-1111-4111-8111-111111111111";
const projection: ProjectionReadModel = {
  eventCursor: "1",
  nodes: [
    { nodeId: goalId, kind: "goal", projectId, goalId, parentNodeId: null, sectorId: "goal", state: "active", version: 1, ownerId: null, crossLinks: [], sourceRevision: "1", eventCursor: "1", removed: false, sourceKey: [goalId] },
    { nodeId: "department-plan-smoke", kind: "department_plan", projectId, goalId, parentNodeId: goalId, sectorId: "engineering", state: "active", version: 1, ownerId: "head-smoke", crossLinks: [], sourceRevision: "1", eventCursor: "1", removed: false, sourceKey: ["department-plan-smoke"] },
  ],
  edges: [],
};



function SmokeProbe() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const result = {
        pass: document.querySelector('[aria-label="Organization radial graph"]') !== null
          && document.body.innerText.includes("Task Contract")
          && document.querySelectorAll('[aria-label="Zoom in"], [aria-label="Pan left"], [aria-label="Search graph nodes"]').length === 3
          && document.querySelectorAll('[data-radial-node-id]').length >= 2,
        graph: document.querySelector('[aria-label="Organization radial graph"]') !== null,
        taskContract: document.body.innerText.includes("Task Contract"),
        controls: document.querySelectorAll('[aria-label="Zoom in"], [aria-label="Pan left"], [aria-label="Search graph nodes"]').length,
        sourceNodes: document.querySelectorAll('[data-radial-node-id]').length,
      };
      console.log(`RADIAL_SMOKE:${JSON.stringify(result)}`);
    }, 750);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(<><RadialGraph projection={projection} selectedGoalId={goalId} onBack={() => undefined} /><SmokeProbe /></>);
