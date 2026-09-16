import { describe, expect, it } from "vitest";
import type { GoalEvent } from "@maestro/api-client";
import { runLiveActivityStream } from "./activity-live-stream.js";

const cursorEvent = {
  cursor: "7",
  eventId: "00000000-0000-4000-8000-000000000004",
  projectId: "00000000-0000-4000-8000-000000000002",
  goalId: "00000000-0000-4000-8000-000000000003",
  aggregateVersion: "1",
  eventType: "goal.created",
  schemaVersion: 1,
  payload: {},
  occurredAt: "2026-01-01T00:00:00.000Z",
} as GoalEvent;

const event = {
  cursor: "1",
  eventId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  goalId: "00000000-0000-4000-8000-000000000003",
  aggregateVersion: "1",
  eventType: "goal.started",
  schemaVersion: 1,
  payload: {},
  occurredAt: "2026-01-01T00:00:00.000Z",
} as GoalEvent;

describe("live activity orchestration", () => {
  it("captures the cursor once, processes a current event, saves, and renders", async () => {
    const controller = new AbortController();
    const order: string[] = [];
    let state = { activity: [cursorEvent] as GoalEvent[], session: undefined };
    let reads = 0;
    await runLiveActivityStream({
      client: {
        async *streamEvents(query) {
          expect(query).toEqual({ projectId: event.projectId, after: "7" });
          yield event;
        },
      },
      projectId: event.projectId,
      signal: controller.signal,
      readState: () => {
        reads += 1;
        return state;
      },
      isCurrent: () => true,
      workspacePath: "/workspace",
      dismissSplash: () => order.push("dismiss"),
      setActivity: (activity) => {
        order.push("activity");
        state = { ...state, activity };
      },
      setSession: (session) => {
        order.push("session");
        state = { ...state, session };
        controller.abort();
      },
      saveSession: async () => order.push("save"),
      append: (line) => order.push(typeof line === "string" ? line : line.text),
      render: () => order.push("render"),
    });
    expect(reads).toBe(2);
    expect(state.activity).toEqual([cursorEvent, event]);
    expect(order).toEqual(["dismiss", "activity", "save", "activity", "session", "render"]);
  });

  it("does not process stale events", async () => {
    const controller = new AbortController();
    let processed = false;
    await runLiveActivityStream({
      client: {
        async *streamEvents() {
          yield event;
          controller.abort();
        },
      },
      projectId: event.projectId,
      signal: controller.signal,
      readState: () => ({ activity: [], session: undefined }),
      cursor: "0",
      isCurrent: () => false,
      workspacePath: "/workspace",
      dismissSplash: () => {
        processed = true;
      },
      setActivity: () => {
        processed = true;
      },
      setSession: () => {
        processed = true;
      },
      saveSession: async () => {
        processed = true;
      },
      append: () => {
        processed = true;
      },
      render: () => {
        processed = true;
      },
    });
    expect(processed).toBe(false);
  });
});
