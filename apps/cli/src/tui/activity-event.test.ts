import { describe, expect, it, vi } from "vitest";
import type { GoalEvent } from "@maestro/api-client";
import { processActivityEvent } from "./activity-event.js";

const activityEvent: GoalEvent = {
  cursor: "1",
  eventId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  goalId: "33333333-3333-4333-8333-333333333333",
  aggregateVersion: "1",
  eventType: "goal_created",
  schemaVersion: 1,
  payload: {},
  occurredAt: "2020-01-01T00:00:00.000Z",
};

describe("live activity event boundary", () => {
  it("merges the event and persists the advanced workspace session", async () => {
    const saveSession = vi.fn(async () => undefined);
    const current = {
      workspacePath: "/workspace",
      projectId: activityEvent.projectId,
      goalId: activityEvent.goalId,
      model: "openai/gpt-5",
    };

    await expect(
      processActivityEvent({
        activity: [],
        event: activityEvent,
        workspacePath: "/workspace",
        current,
        isCurrent: () => true,
        saveSession,
        onMerged: vi.fn(),
      }),
    ).resolves.toEqual({
      activity: [activityEvent],
      session: { ...current, lastEventCursor: "1" },
    });
    expect(saveSession).toHaveBeenCalledWith({ ...current, lastEventCursor: "1" });
  });

  it("does not persist when the owning view becomes stale before saving", async () => {
    const saveSession = vi.fn(async () => undefined);
    let checks = 0;

    await expect(
      processActivityEvent({
        activity: [],
        event: activityEvent,
        workspacePath: "/workspace",
        current: undefined,
        isCurrent: () => checks++ === 0 && checks < 3,
        saveSession,
        onMerged: vi.fn(),
      }),
    ).resolves.toEqual({ activity: [activityEvent] });
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("keeps the in-memory merge when the view becomes stale after saving", async () => {
    const saveSession = vi.fn(async () => undefined);
    const current = { workspacePath: "/workspace", projectId: activityEvent.projectId, goalId: activityEvent.goalId };
    let checks = 0;

    await expect(
      processActivityEvent({
        activity: [],
        event: activityEvent,
        workspacePath: "/workspace",
        current,
        isCurrent: () => checks++ < 2,
        saveSession,
        onMerged: vi.fn(),
      }),
    ).resolves.toEqual({ activity: [activityEvent] });
    expect(saveSession).toHaveBeenCalledWith({ ...current, lastEventCursor: "1" });
  });

  it("exposes the in-memory merge before propagating a persistence failure", async () => {
    const saveError = new Error("disk unavailable");
    const saveSession = vi.fn(async () => {
      throw saveError;
    });
    const onMerged = vi.fn();

    await expect(
      processActivityEvent({
        activity: [],
        event: activityEvent,
        workspacePath: "/workspace",
        current: undefined,
        isCurrent: () => true,
        saveSession,
        onMerged,
      }),
    ).rejects.toThrow(saveError);
    expect(onMerged).toHaveBeenCalledWith([activityEvent]);
  });
});
