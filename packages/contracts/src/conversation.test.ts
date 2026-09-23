import { describe, expect, it } from "vitest";
import {
  boundedText,
  cancellationContent,
  MAX_PERSISTED_TEXT_BYTES,
  terminalEventType,
  turnStatus,
  ConversationSchema,
  CreateConversationInputSchema,
} from "./schemas/conversation.js";

describe("conversation reasoning effort contract", () => {
  it("accepts an optional provider-native effort on creation and exposes the persisted value", () => {
    expect(CreateConversationInputSchema.parse({ projectId: "11111111-1111-4111-8111-111111111111", goalId: null, model: "openai-codex/gpt-5.6-sol", reasoningEffort: "high" }).reasoningEffort).toBe("high");
    expect(ConversationSchema.parse({ conversationId: "22222222-2222-4222-8222-222222222222", projectId: "11111111-1111-4111-8111-111111111111", goalId: null, model: "openai-codex/gpt-5.6-sol", reasoningEffort: null, status: "active", version: 1 }).reasoningEffort).toBeNull();
  });
});

describe("conversation text bounds", () => {
  it("keeps short text intact", () => {
    expect(boundedText("hello")).toBe("hello");
    expect(boundedText("")).toBe("");
  });

  it("truncates to the byte budget without splitting input", () => {
    const text = `a${"é".repeat(40_000)}`;
    const bounded = boundedText(text);
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(MAX_PERSISTED_TEXT_BYTES);
    expect(text.startsWith(bounded)).toBe(true);
  });

  it("never splits a surrogate pair", () => {
    expect(boundedText("a𝄞b", 3)).toBe("a");
  });

  it("honors an explicit smaller budget", () => {
    expect(boundedText("hello world", 5)).toBe("hello");
  });
});

describe("conversation terminal mappings", () => {
  it("maps statuses to terminal event types", () => {
    expect(terminalEventType("succeeded")).toBe("turn_completed");
    expect(terminalEventType("cancelled")).toBe("turn_cancelled");
    expect(terminalEventType("unknown")).toBe("turn_unknown");
    expect(terminalEventType("failed")).toBe("turn_failed");
    expect(terminalEventType("running")).toBe("turn_failed");
  });

  it("maps statuses to turn states", () => {
    expect(turnStatus("succeeded")).toBe("completed");
    expect(turnStatus("failed")).toBe("failed");
    expect(turnStatus("cancelled")).toBe("cancelled");
    expect(turnStatus("unknown")).toBe("unknown");
  });

  it("explains cancellations distinctly from other failures", () => {
    expect(cancellationContent("cancelled")).toBe("Conversation turn cancelled");
    expect(cancellationContent("unknown")).toBe("Conversation turn outcome is unavailable");
  });
});
