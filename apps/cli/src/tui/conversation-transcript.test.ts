import { describe, expect, it } from "vitest";
import {
  addConversationMessage,
  applyConversationEvent,
  createConversationTranscript,
  renderConversationMarkdown,
} from "./conversation-transcript.js";

const base = {
  cursor: "1",
  eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04",
  conversationId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03",
  projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01",
  occurredAt: "2030-01-01T00:00:00.000Z",
};

const event = (eventType: string, cursor: string, payload: Record<string, unknown>) => ({ ...base, eventType, cursor, payload });

describe("conversation transcript", () => {
  it("carries the source semantic kind with transcript messages", () => {
    const state = addConversationMessage(createConversationTranscript(), "system", "Gateway unavailable", "error");

    expect(state.messages).toEqual([{ role: "system", content: "Gateway unavailable", kind: "error" }]);
  });

  it("renders user and assistant Markdown while a turn streams", () => {
    let state = createConversationTranscript();
    state = addConversationMessage(state, "user", "Explain **durable cursors**");
    state = applyConversationEvent(state, event("turn_started", "2", { turnId: "turn-1", text: "Explain **durable cursors**" }));
    state = applyConversationEvent(state, event("turn_delta", "3", { turnId: "turn-1", text: "They let us **reconnect**." }));

    expect(renderConversationMarkdown(state)).toContain("**You**");
    expect(renderConversationMarkdown(state)).toContain("They let us **reconnect**.");
    expect(state.status).toBe("streaming");
  });

  it("deduplicates replayed cursors and exposes terminal status", () => {
    let state = createConversationTranscript();
    state = applyConversationEvent(state, event("turn_started", "2", { turnId: "turn-1" }));
    state = applyConversationEvent(state, event("turn_delta", "3", { turnId: "turn-1", text: "once" }));
    state = applyConversationEvent(state, event("turn_delta", "3", { turnId: "turn-1", text: " again" }));
    state = applyConversationEvent(state, event("turn_completed", "4", { turnId: "turn-1", status: "succeeded" }));

    expect(state.assistantText).toBe("once");
    expect(state.status).toBe("succeeded");
    expect(renderConversationMarkdown(state)).toContain("succeeded");
  });


  it("keeps completed turns when the next turn starts", () => {
    let state = createConversationTranscript();
    state = applyConversationEvent(state, event("turn_started", "1", { turnId: "turn-1", text: "first" }));
    state = applyConversationEvent(state, event("turn_delta", "2", { turnId: "turn-1", text: "answer one" }));
    state = applyConversationEvent(state, event("turn_completed", "3", { turnId: "turn-1", status: "succeeded" }));
    state = applyConversationEvent(state, event("turn_started", "4", { turnId: "turn-2", text: "second" }));
    state = applyConversationEvent(state, event("turn_delta", "5", { turnId: "turn-2", text: "answer two" }));

    const markdown = renderConversationMarkdown(state);
    expect(markdown).toContain("answer one");
    expect(markdown).toContain("answer two");
  });

  it("shows cancellation, unknown, and provider failures without pretending success", () => {
    let state = createConversationTranscript();
    state = applyConversationEvent(state, event("turn_started", "2", { turnId: "turn-1" }));
    state = applyConversationEvent(state, event("turn_unknown", "3", { turnId: "turn-1", message: "Gateway restart" }));
    expect(state.status).toBe("unknown");
    expect(renderConversationMarkdown(state)).toContain("Gateway restart");

    state = applyConversationEvent(state, event("turn_cancelled", "4", { turnId: "turn-1" }));
    expect(state.status).toBe("cancelled");
    expect(renderConversationMarkdown(state)).toContain("cancelled");
  });
});
