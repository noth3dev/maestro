import { describe, expect, it } from "vitest";
import type { GoalEvent } from "@maestro/api-client";
import { hydrateActivityHistory } from "./activity-history-hydration.js";

const event = {
  cursor: "1",
  eventId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  goalId: "00000000-0000-4000-8000-000000000003",
  aggregateVersion: "1",
  eventType: "goal.created",
  schemaVersion: 1,
  payload: {},
  occurredAt: "2026-01-01T00:00:00.000Z",
} as GoalEvent;

describe("activity history hydration", () => {
  it("merges current history and renders after setting activity", async () => {
    const order: string[] = [];
    let activity: GoalEvent[] = [];
    await hydrateActivityHistory({
      client: { listEvents: async () => ({ events: [event], nextCursor: event.cursor }) },
      projectId: event.projectId,
      readActivity: () => {
        order.push("read");
        return activity;
      },
      setActivity: (nextActivity) => {
        order.push("set");
        activity = nextActivity;
      },
      isCurrent: () => true,
      onWarning: (message) => order.push(`warning:${message}`),
      render: () => order.push("render"),
    });
    expect(activity).toEqual([event]);
    expect(order).toEqual(["read", "set", "render"]);
  });

  it("does not update or render stale history", async () => {
    const order: string[] = [];
    await hydrateActivityHistory({
      client: { listEvents: async () => ({ events: [event], nextCursor: event.cursor }) },
      projectId: event.projectId,
      readActivity: () => {
        order.push("read");
        return [];
      },
      setActivity: () => order.push("set"),
      isCurrent: () => false,
      onWarning: (message) => order.push(`warning:${message}`),
      render: () => order.push("render"),
    });
    expect(order).toEqual([]);
  });

  it("warns on a current history failure", async () => {
    const order: string[] = [];
    await hydrateActivityHistory({
      client: {
        listEvents: async () => {
          throw new Error("offline");
        },
      },
      projectId: event.projectId,
      readActivity: () => [],
      setActivity: () => order.push("set"),
      isCurrent: () => true,
      onWarning: (message) => order.push(`warning:${message}`),
      render: () => order.push("render"),
    });
    expect(order).toEqual(["warning:Activity history unavailable: offline"]);
  });

  it("suppresses a warning after a stale history failure", async () => {
    const order: string[] = [];
    await hydrateActivityHistory({
      client: {
        listEvents: async () => {
          throw new Error("offline");
        },
      },
      projectId: event.projectId,
      readActivity: () => [],
      setActivity: () => order.push("set"),
      isCurrent: () => false,
      onWarning: (message) => order.push(`warning:${message}`),
      render: () => order.push("render"),
    });
    expect(order).toEqual([]);
  });
});
