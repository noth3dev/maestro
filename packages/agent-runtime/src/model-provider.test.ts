import { describe, expect, it } from "vitest";
import {
  normalizeToolArguments,
  parseModelRef,
  type ModelMessage,
  type ModelStreamEvent,
  type ProviderCancellationOutcome,
  type TurnLimits,
} from "./model-provider.js";

describe("provider-neutral model contracts", () => {
  it("preserves malformed tool arguments as rejected data", () => {
    expect(normalizeToolArguments("{")).toEqual({
      state: "invalid",
      raw: "{",
      reason: "malformed-json",
    });
    expect(normalizeToolArguments(["not", "an", "object"])).toEqual({
      state: "invalid",
      raw: '["not","an","object"]',
      reason: "not-an-object",
    });
  });

  it("normalizes valid object arguments without granting authority", () => {
    expect(normalizeToolArguments({ goalId: "goal-1" })).toEqual({
      state: "valid",
      value: { goalId: "goal-1" },
    });
  });

  it("requires canonical provider-qualified model references", () => {
    expect(parseModelRef("openai/gpt-5")).toEqual({ provider: "openai", id: "gpt-5" });
    expect(() => parseModelRef("gpt-5")).toThrow("provider-qualified");
    expect(() => parseModelRef("openai/")).toThrow("model id");
    expect(() => parseModelRef("openai/gpt-5/extra")).toThrow("provider-qualified");
  });

  it("models bounded, correlated messages and stream events", () => {
    const limits: TurnLimits = {
      maxModelTurns: 2,
      maxToolCalls: 4,
      maxChildCalls: 1,
      maxOutputTokens: 512,
      maxInputBytes: 16_384,
      maxResultBytes: 8_192,
      providerTimeoutMs: 30_000,
      wallTimeMs: 60_000,
    };
    const message: ModelMessage = {
      role: "tool",
      content: [{
        kind: "tool-result",
        toolCallId: "call-1",
        status: "ok",
        content: "untrusted Goal data",
        origin: "host",
        trust: "untrusted-data",
      }],
    };
    const event: ModelStreamEvent = {
      kind: "tool-completed",
      cursor: 3,
      callId: "call-1",
      toolName: "readGoal",
      status: "ok",
    };

    expect(limits.maxToolCalls).toBe(4);
    expect(message.content[0]).toMatchObject({ toolCallId: "call-1", trust: "untrusted-data" });
    expect(event).toMatchObject({ cursor: 3, callId: "call-1" });
  });

  it("uses a typed cancellation outcome instead of Promise<void>", () => {
    const outcome: ProviderCancellationOutcome = { state: "unknown", providerRequestRef: "provider-request-1" };
    expect(outcome.state).toBe("unknown");
  });
});
