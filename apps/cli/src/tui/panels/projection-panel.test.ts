import { describe, expect, it } from "vitest";
import type { OrganizationReadModel } from "@maestro/api-client";
import type { ProjectionReadModel } from "@maestro/contracts";
import { renderProjectionPanel } from "./projection-panel.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const organization: OrganizationReadModel = {
  groups: [{ groupId: "tech", displayName: "Tech Group" }],
  departments: [{ departmentId: "engineering", groupId: "tech", displayName: "Engineering Department", status: "sleeping", activeSessionId: null, goalContext: null }],
};
const projection: ProjectionReadModel = {
  eventCursor: "9",
  nodes: [
    { nodeId: goalId, kind: "goal", projectId, goalId, parentNodeId: null, sectorId: null, state: "active", version: 1, ownerId: null, crossLinks: [], sourceRevision: "1", eventCursor: "9", removed: false, sourceKey: [goalId] },
    { nodeId: "plan-engineering", kind: "department_plan", projectId, goalId, parentNodeId: goalId, sectorId: "engineering", state: "active", version: 2, ownerId: "head-engineering", crossLinks: [], sourceRevision: "2", eventCursor: "9", removed: false, sourceKey: ["council", "engineering"] },
    { nodeId: "bundle-engineering", kind: "mission_bundle", projectId, goalId, parentNodeId: "plan-engineering", sectorId: "engineering", state: "issued", version: null, ownerId: "engineering", crossLinks: [], sourceRevision: "bundle", eventCursor: "9", removed: false, sourceKey: ["bundle-engineering"] },
    { nodeId: "worker-one", kind: "worker", projectId, goalId, parentNodeId: "bundle-engineering", sectorId: "engineering", state: "running", version: null, ownerId: "worker-one", crossLinks: [], sourceRevision: "worker", eventCursor: "9", removed: false, sourceKey: ["worker-one"] },
    { nodeId: "worker-two", kind: "worker", projectId, goalId, parentNodeId: "bundle-engineering", sectorId: "engineering", state: "succeeded", version: null, ownerId: "worker-two", crossLinks: [], sourceRevision: "worker", eventCursor: "9", removed: false, sourceKey: ["worker-two"] },
  ],
  edges: [
    { edgeId: "goal-plan", kind: "contains", fromNodeId: goalId, toNodeId: "plan-engineering", projectId, goalId, sourceRevision: "1", eventCursor: "9", removed: false },
    { edgeId: "plan-bundle", kind: "contains", fromNodeId: "plan-engineering", toNodeId: "bundle-engineering", projectId, goalId, sourceRevision: "1", eventCursor: "9", removed: false },
    { edgeId: "bundle-worker-one", kind: "contains", fromNodeId: "bundle-engineering", toNodeId: "worker-one", projectId, goalId, sourceRevision: "1", eventCursor: "9", removed: false },
    { edgeId: "bundle-worker-two", kind: "contains", fromNodeId: "bundle-engineering", toNodeId: "worker-two", projectId, goalId, sourceRevision: "1", eventCursor: "9", removed: false },
  ],
};

describe("projection panel", () => {
  it("renders the real Department to Group to Head to Worker drill-down", () => {
    const root = renderProjectionPanel({ kind: "value", value: { projection, organization } }, 120);
    expect(root.join("\n")).toContain("Engineering Department");
    expect(root.join("\n")).toContain("1 Group");

    const department = renderProjectionPanel({ kind: "value", value: { projection, organization, departmentId: "engineering" } }, 120);
    expect(department.join("\n")).toContain("Tech Group");
    expect(department.join("\n")).toContain("1 Head");

    const group = renderProjectionPanel({ kind: "value", value: { projection, organization, departmentId: "engineering", groupId: "tech" } }, 120);
    expect(group.join("\n")).toContain("head-engineering");
    expect(group.join("\n")).toContain("2 Workers");

    const head = renderProjectionPanel({ kind: "value", value: { projection, organization, departmentId: "engineering", groupId: "tech", headId: "head-engineering" } }, 120);
    expect(head.join("\n")).toContain("worker-one");
    expect(head.join("\n")).toContain("worker-two");
    expect(head.join("\n")).not.toContain("{\"nodes\"");
  });

  it("renders an honest empty state when no Department nodes are projected", () => {
    const empty: ProjectionReadModel = { nodes: [], edges: [], eventCursor: "0" };
    expect(renderProjectionPanel({ kind: "value", value: { projection: empty, organization } }, 80)).toEqual(["Organization projection", "No Departments are present in the projection."]);
  });

  it("keeps loading and error states explicit", () => {
    expect(renderProjectionPanel({ kind: "loading" }, 80)).toEqual(["Organization projection", "Loading projection…"]);
    expect(renderProjectionPanel({ kind: "error", message: "offline" }, 80)).toEqual(["Organization projection", "Unable to read projection: offline"]);
  });
});
