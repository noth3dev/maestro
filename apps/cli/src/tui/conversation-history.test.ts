import { describe, expect, it, vi } from "vitest";
import type { ConversationEvent } from "@maestro/contracts";
import { loadConversationHistory } from "./conversation-history.js";

const conversationEvent = (cursor: string, eventType = "turn_delta"): ConversationEvent =>
  ({
    cursor,
    eventId: `event-${cursor}`,
    conversationId: "conversation-1",
    projectId: "project-1",
    occurredAt: "2030-01-01T00:00:00.000Z",
    eventType,
    payload: { turnId: "turn-1", text: `message-${cursor}` },
  }) as ConversationEvent;

describe("conversation history loading", () => {
  it("hydrates events until a short page and returns the transcript", async () => {
    const listConversationEvents = vi.fn().mockResolvedValue([conversationEvent("1", "turn_started"), conversationEvent("2")]);

    await expect(
      loadConversationHistory({
        client: { listConversationEvents },
        conversationId: "conversation-1",
        projectId: "project-1",
        isCurrent: () => true,
      }),
    ).resolves.toMatchObject({ status: "streaming", assistantText: "message-2" });
    expect(listConversationEvents).toHaveBeenCalledWith("conversation-1", { projectId: "project-1", after: "0" });
  });

  it("stops without returning a partial transcript when the view becomes stale", async () => {
    const listConversationEvents = vi.fn().mockResolvedValue([conversationEvent("1")]);
    let checks = 0;

    await expect(
      loadConversationHistory({
        client: { listConversationEvents },
        conversationId: "conversation-1",
        projectId: "project-1",
        isCurrent: () => checks++ > 0,
      }),
    ).resolves.toBeUndefined();
  });
});
