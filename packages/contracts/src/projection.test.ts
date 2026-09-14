import { describe, expect, it } from "vitest";
import {
  ProjectionEdgeSchema,
  ProjectionEventSchema,
  ProjectionNodeSchema,
  ProjectionReadModelSchema,
} from "./index.js";

const goalId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02";
const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const node = {
  nodeId: goalId,
  kind: "goal" as const,
  projectId,
  goalId,
  parentNodeId: null,
  sectorId: projectId,
  state: "active",
  version: 3,
  ownerId: null,
  crossLinks: [],
  sourceRevision: "3",
  eventCursor: "12",
  removed: false,
  sourceKey: [goalId],
};

describe("Phase 7 projection contracts", () => {
  it("preserves durable identity, version, hierarchy, ownership, and source cursor", () => {
    expect(ProjectionNodeSchema.parse(node)).toEqual(node);
    expect(ProjectionEdgeSchema.parse({ edgeId: "goal-council", kind: "contains", fromNodeId: goalId, toNodeId: goalId, goalId, projectId, sourceRevision: "1", eventCursor: "12", removed: false })).toMatchObject({ fromNodeId: goalId });
    expect(ProjectionReadModelSchema.parse({ nodes: [node], edges: [], eventCursor: "12" })).toMatchObject({ nodes: [node] });
  });

  it("accepts an idempotent upsert and explicit removal event", () => {
    const upsert = { eventId: goalId, cursor: "12", kind: "upsert" as const, node };
    const remove = { eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", cursor: "13", kind: "remove" as const, nodeId: goalId };
    expect(ProjectionEventSchema.parse(upsert)).toEqual(upsert);
    expect(ProjectionEventSchema.parse(remove)).toEqual(remove);
  });
});
