import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@maestro/api-client";
import { loadGoalPageData } from "./goal-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";

describe("loadGoalPageData", () => {
  it("loads the Goal and filters events down to that Goal", async () => {
    const otherGoalId = "33333333-3333-4333-8333-333333333333";
    const api = {
      getGoal: vi.fn().mockResolvedValue({ goalId, projectId, state: "paused", version: 7 }),
      listEvents: vi.fn().mockResolvedValue({
        nextCursor: "9",
        events: [
          { cursor: "8", eventId: "44444444-4444-4444-8444-444444444444", projectId, goalId, aggregateVersion: "7", eventType: "GoalPaused", schemaVersion: 1, payload: {}, occurredAt: "2026-09-01T00:00:00.000Z" },
          { cursor: "9", eventId: "55555555-5555-4555-8555-555555555555", projectId, goalId: otherGoalId, aggregateVersion: "1", eventType: "GoalCreated", schemaVersion: 1, payload: {}, occurredAt: "2026-09-01T00:00:01.000Z" },
        ],
      }),
    } as unknown as ApiClient;

    const data = await loadGoalPageData(api, { projectId, goalId });

    expect(api.getGoal).toHaveBeenCalledWith(goalId, { projectId });
    expect(api.listEvents).toHaveBeenCalledWith({ projectId, after: "0" });
    expect(data.goal.state).toBe("paused");
    expect(data.events).toHaveLength(1);
    expect(data.events[0]?.eventType).toBe("GoalPaused");
  });
});
