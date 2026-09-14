import { describe, expect, it } from "vitest";
import { applyProjectionEvents, createProjectionService, emptyProjection, ProjectionConsistencyError } from "./projection-service.js";

const goalId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02";
const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const node = {
  nodeId: goalId, kind: "goal" as const, projectId, goalId, parentNodeId: null, sectorId: projectId,
  state: "active", version: 1, ownerId: null, crossLinks: [], sourceRevision: "1", eventCursor: "1", removed: false,
  sourceKey: [goalId],
};

describe("projection composition", () => {
  it("does not change when the same durable event is delivered twice", () => {
    const event = { eventId: goalId, cursor: "1", kind: "upsert" as const, node };
    const once = applyProjectionEvents(emptyProjection(), [event]);
    expect(applyProjectionEvents(once, [event])).toEqual(once);
  });

  it("marks a removed source explicitly rather than omitting it", () => {
    const upsert = applyProjectionEvents(emptyProjection(), [{ eventId: goalId, cursor: "1", kind: "upsert" as const, node }]);
    const removed = applyProjectionEvents(upsert, [{ eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", cursor: "2", kind: "remove" as const, nodeId: goalId }]);
    expect(removed.nodes).toContainEqual({ ...node, removed: true, eventCursor: "2" });
  });

  it("composes a durable read with one query", async () => {
    const calls: string[] = [];
    const pool = { query: async (sql: string) => { calls.push(sql); return { rows: [], rowCount: 0 }; } } as never;
    await createProjectionService(pool).read({ projectId });
    expect(calls).toHaveLength(1);
  });


  it("keeps graph addresses unique while exposing the exact durable source key", async () => {
    const rows = [
      { node_id: goalId, kind: "goal", project_id: projectId, goal_id: goalId, parent_node_id: null, sector_id: null, state: "active", version: "1", owner_id: null, cross_links: [], source_revision: "1", event_cursor: "1", removed: false, source_key: [goalId] },
      { node_id: `git-goal-branch:${goalId}`, kind: "git_goal_branch", project_id: projectId, goal_id: goalId, parent_node_id: goalId, sector_id: null, state: "recorded", version: null, owner_id: null, cross_links: [], source_revision: "2026-01-01T00:00:00.000Z", event_cursor: "1", removed: false, source_key: [goalId] },
    ];
    const pool = { query: async () => ({ rows, rowCount: rows.length }) } as never;
    const result = await createProjectionService(pool).read({ projectId });
    expect(result.nodes.map((entry) => entry.nodeId)).toEqual([goalId, `git-goal-branch:${goalId}`]);
    expect(result.nodes.find((entry) => entry.kind === "git_goal_branch")?.sourceKey).toEqual([goalId]);
  });

  it("fails closed instead of returning a regressed durable version", async () => {
    let version = "2";
    const row = {
      node_id: goalId, kind: "goal", project_id: projectId, goal_id: goalId, parent_node_id: null, sector_id: projectId,
      state: "active", version: "2", owner_id: null, cross_links: [], source_revision: "2", event_cursor: "2", removed: false,
      source_key: [goalId],
    };
    const pool = { query: async () => ({ rows: [{ ...row, version, source_revision: version, event_cursor: version }], rowCount: 1 }) } as never;
    const service = createProjectionService(pool);
    const first = await service.read({ projectId });
    version = "1";
    await expect(service.read({ projectId }, first)).rejects.toBeInstanceOf(ProjectionConsistencyError);
  });

  it("marks a source absent after reconciliation as removed", async () => {
    const row = {
      node_id: goalId, kind: "goal", project_id: projectId, goal_id: goalId, parent_node_id: null, sector_id: projectId,
      state: "active", version: "1", owner_id: null, cross_links: [], source_revision: "1", event_cursor: "1", removed: false,
      source_key: [goalId],
    };
    let present = true;
    const pool = { query: async () => ({ rows: present ? [row] : [], rowCount: present ? 1 : 0 }) } as never;
    const service = createProjectionService(pool);
    const first = await service.read({ projectId });
    present = false;
    const second = await service.read({ projectId }, first);
    expect(second.nodes).toContainEqual({ ...node, removed: true });
  });
});
