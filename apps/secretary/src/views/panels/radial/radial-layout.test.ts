import { describe, expect, it } from "vitest";
import type { ProjectionReadModel } from "@carnegie/contracts";
import { buildRadialLayout, filterRadialEdges } from "./radial-layout.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const node = (overrides: Record<string, unknown>) => ({
  nodeId: "node", kind: "worker" as const, projectId, goalId, parentNodeId: null, sectorId: "engineering", state: "running", version: null, ownerId: null, crossLinks: [], sourceRevision: "1", eventCursor: "1", removed: false, sourceKey: ["node"], ...overrides,
});
const projection: ProjectionReadModel = {
  eventCursor: "8",
  nodes: [
    node({ nodeId: goalId, kind: "goal", parentNodeId: null, sectorId: "goal", state: "active", version: 4, sourceKey: [goalId] }),
    node({ nodeId: "plan-engineering", kind: "department_plan", parentNodeId: "council", sectorId: "engineering", state: "active", version: 2, ownerId: "eng-head", sourceKey: ["plan-engineering"] }),
    node({ nodeId: "plan-research", kind: "department_plan", parentNodeId: "council", sectorId: "research", state: "active", version: 1, ownerId: "research-head" }),
    node({ nodeId: "worker-engineering", parentNodeId: "plan-engineering", sectorId: "engineering", state: "running" }),
    node({ nodeId: "worker-research", parentNodeId: "plan-research", sectorId: "research", state: "sleeping" }),
  ],
  edges: [
    { edgeId: "contains-1", kind: "contains", fromNodeId: goalId, toNodeId: "plan-engineering", projectId, goalId, sourceRevision: "2", eventCursor: "8", removed: false },
    { edgeId: "cross-1", kind: "references", fromNodeId: "worker-engineering", toNodeId: "worker-research", projectId, goalId, sourceRevision: "1", eventCursor: "8", removed: false },
  ],
};

describe("radial projection layout", () => {
  it("keeps Concertmaster fixed and places the selected Goal in the inner halo", () => {
    const layout = buildRadialLayout(projection, { selectedGoalId: goalId });
    expect(layout.nodes.find((node) => node.id === "ui:radial:concertmaster")).toMatchObject({ x: 0, y: 0, synthetic: true });
    expect(layout.nodes.find((node) => node.id === `ui:radial:task-contract:${goalId}`)).toMatchObject({ kind: "task_contract", radius: 64, synthetic: true });
    expect(layout.nodes.find((node) => node.id === goalId)).toMatchObject({ radius: 96, sourceKey: [goalId] });
  });

  it("assigns participating sectors distinct angles and preserves projection identity/version", () => {
    const layout = buildRadialLayout(projection, { selectedGoalId: goalId });
    const engineering = layout.nodes.find((node) => node.id === "plan-engineering");
    const research = layout.nodes.find((node) => node.id === "plan-research");
    expect(engineering?.angle).not.toBe(research?.angle);
    expect(engineering).toMatchObject({ sourceKey: ["plan-engineering"], version: 2, kind: "department_plan" });
  });

  it("hides cross-sector edges until a node is selected", () => {
    expect(filterRadialEdges(projection.edges, undefined).find((edge) => edge.edgeId === "cross-1")?.hidden).toBe(true);
    expect(filterRadialEdges(projection.edges, "worker-engineering").find((edge) => edge.edgeId === "cross-1")?.hidden).toBe(false);
  });


  it("gives concurrent Goals separate sectors and compresses unfocused Goal detail", () => {
    const secondGoal = node({ nodeId: "goal-2", goalId: "goal-2", kind: "goal", sectorId: "goal", sourceKey: ["goal-2"], state: "running" });
    const secondPlan = node({ nodeId: "plan-2", goalId: "goal-2", parentNodeId: "goal-2", sectorId: "research", sourceKey: ["plan-2"], ownerId: "research-head", kind: "department_plan" });
    const layout = buildRadialLayout({ ...projection, nodes: [...projection.nodes, secondGoal, secondPlan] }, { selectedGoalId: goalId });
    const goals = layout.nodes.filter((entry) => entry.kind === "goal");
    expect(goals).toHaveLength(2);
    expect(goals.find((entry) => entry.id === goalId)?.radius).toBe(96);
    expect(goals.find((entry) => entry.id === "goal-2")?.radius).toBeGreaterThan(96);
    expect(layout.nodes.find((entry) => entry.id === "plan-2")?.compressed).toBe(true);
    expect(goals[0]?.angle).not.toBe(goals[1]?.angle);
  });

  it("collapses sleeping Departments and exposes their workers only after selection", () => {
    const sleepingPlan = node({ nodeId: "sleeping-plan", kind: "department_plan", parentNodeId: goalId, sectorId: "finance", state: "sleeping", sourceKey: ["sleeping-plan"] });
    const sleepingWorker = node({ nodeId: "sleeping-worker", parentNodeId: "sleeping-plan", sectorId: "finance", state: "sleeping", sourceKey: ["sleeping-worker"] });
    const withSleeping = { ...projection, nodes: [...projection.nodes, sleepingPlan, sleepingWorker] };
    expect(buildRadialLayout(withSleeping, { selectedGoalId: goalId }).nodes.find((entry) => entry.id === "sleeping-worker")?.collapsed).toBe(true);
    expect(buildRadialLayout(withSleeping, { selectedGoalId: goalId, selectedNodeId: "sleeping-plan" }).nodes.find((entry) => entry.id === "sleeping-worker")?.collapsed).toBe(false);
    const sectorId = buildRadialLayout(withSleeping, { selectedGoalId: goalId }).nodes.find((entry) => entry.id === "sleeping-plan")?.id;
    expect(sectorId).toBe("sleeping-plan");
    const sectorNode = buildRadialLayout(withSleeping, { selectedGoalId: goalId }).nodes.find((entry) => entry.kind === "sector" && entry.label === "finance");
    expect(sectorNode).toBeDefined();
    const sectorOptions = sectorNode === undefined ? { selectedGoalId: goalId } : { selectedGoalId: goalId, selectedNodeId: sectorNode.id };
    expect(buildRadialLayout(withSleeping, sectorOptions).nodes.find((entry) => entry.id === "sleeping-worker")?.collapsed).toBe(false);
  });

  it("keeps labels upright and retains every critical blocker in a large graph", () => {
    const manyNodes = Array.from({ length: 60 }, (_, index) => node({ nodeId: `worker-${index}`, sourceKey: [`worker-${index}`], state: index === 59 ? "blocked" : "running" }));
    const large: ProjectionReadModel = { ...projection, nodes: [...projection.nodes, ...manyNodes] };
    const layout = buildRadialLayout(large, { selectedGoalId: goalId, maxVisibleNodes: 20 });
    expect(layout.nodes.every((entry) => entry.labelRotation === 0)).toBe(true);
    expect(layout.nodes.some((entry) => entry.sourceKey?.[0] === "worker-59")).toBe(true);
    expect(layout.nodes.filter((entry) => entry.synthetic === false)).toHaveLength(65);
    expect(layout.virtualized).toBe(true);
  });
});
