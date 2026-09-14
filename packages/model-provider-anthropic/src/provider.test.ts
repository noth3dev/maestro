import { describe, expect, it, vi } from "vitest";
import { createAnthropicPlugin } from "./index.js";
import type { ModelTurnRequest } from "@maestro/agent-runtime";

const request: ModelTurnRequest = {
  requestId: "request-1", sessionId: "session-1", turnId: "turn-1",
  messages: [{ role: "user", content: [{ kind: "text", text: "show the Goal" }] }],
  tools: [{ name: "readGoal", version: "1", description: "Read Goal", inputSchema: { type: "object" }, outputSchema: { type: "object" }, allowsParallel: false, outboundDataClass: "workspace" }],
  limits: { maxModelTurns: 2, maxToolCalls: 4, maxChildCalls: 1, maxOutputTokens: 128, maxInputBytes: 4096, maxResultBytes: 4096, providerTimeoutMs: 5000, wallTimeMs: 10000 },
  signal: new AbortController().signal,
  emit: vi.fn(),
};

describe("Anthropic provider adapter", () => {
  it("normalizes Messages tool_use without executing it", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "x-api-key": "api-secret", "anthropic-version": "2023-06-01" });
      const body = JSON.parse(String(init?.body)) as { model: string; tools: unknown[]; max_tokens: number };
      expect(body.model).toBe("claude-test");
      expect(body.max_tokens).toBe(128);
      expect(body.tools).toHaveLength(1);
      return new Response(JSON.stringify({
        model: "claude-test",
        content: [{ type: "tool_use", id: "toolu-1", name: "readGoal", input: { goalId: "goal-1" } }],
        usage: { input_tokens: 7, output_tokens: 3 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = await createAnthropicPlugin({ fetch, resolveApiKey: async () => "api-secret", models: ["claude-test"] }).create({
      model: { provider: "anthropic", id: "claude-test" },
      account: { providerId: "anthropic", accountRef: "account-1", authMode: "api-key" },
      dataPolicyHash: "policy-1",
    });

    const result = await provider.turn(request);

    expect(result).toMatchObject({ model: { provider: "anthropic", id: "claude-test" }, stopReason: "tool_use" });
    expect(result.toolCalls).toEqual([{ id: "toolu-1", name: "readGoal", arguments: { state: "valid", value: { goalId: "goal-1" } } }]);
    expect(result.usage).toEqual({ state: "available", totalTokens: 10 });
  });

  it("does not expose error response bodies", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ secret: "do-not-log" }), { status: 429 }));
    const provider = await createAnthropicPlugin({ fetch, resolveApiKey: async () => "api-secret", models: ["claude-test"] }).create({
      model: { provider: "anthropic", id: "claude-test" },
      account: { providerId: "anthropic", accountRef: "account-1", authMode: "api-key" },
      dataPolicyHash: "policy-1",
    });
    await expect(provider.turn(request)).rejects.toMatchObject({ code: "provider_quota" });
  });
});
