import { describe, expect, it } from "vitest";
import { activityView, runConversationActivityStream } from "./conversation-activity.js";

const event = {
  activityId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01",
  conversationId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02",
  projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03",
  turnId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04",
  phase: "executing" as const,
  toolName: "readGoal",
  status: "executing" as const,
  occurredAt: "2030-01-01T00:00:00.000Z",
};

describe("conversation activity tracker", () => {
  it("projects only the safe live view fields", () => {
    expect(activityView(event)).toEqual({ phase: "executing", toolName: "readGoal", status: "executing" });
  });

  it("forwards the activity connection callback", async () => {
    const controller = new AbortController();
    let connected = false;
    const client = {
      async *streamConversationActivity(
        _conversationId: string,
        _query: { projectId: string },
        options?: { signal?: AbortSignal; onConnected?: () => void },
      ) {
        options?.onConnected?.();
        controller.abort();
        yield event;
      },
    };
    await runConversationActivityStream({
      client,
      conversationId: event.conversationId,
      projectId: event.projectId,
      signal: controller.signal,
      onEvent: () => {},
      onConnected: () => {
        connected = true;
      },
    });
    expect(connected).toBe(true);
  });

  it("stops the best-effort stream when the turn is finished", async () => {
    const controller = new AbortController();
    const received: unknown[] = [];
    const client = {
      async *streamConversationActivity() {
        yield event;
      },
    };
    await runConversationActivityStream({
      client,
      conversationId: event.conversationId,
      projectId: event.projectId,
      signal: controller.signal,
      onEvent: (next) => {
        received.push(next);
        controller.abort();
      },
    });
    expect(received).toEqual([event]);
  });
});
