import { describe, expect, it, vi } from "vitest";
import { createOpenAiPlugin } from "./index.js";
import type { ModelTurnRequest } from "@maestro/agent-runtime";

const request: ModelTurnRequest = {
  requestId: "request-1", sessionId: "session-1", turnId: "turn-1",
  messages: [{ role: "user", content: [{ kind: "text", text: "show the Goal" }] }],
  tools: [{ name: "readGoal", version: "1", description: "Read Goal", inputSchema: { type: "object" }, outputSchema: { type: "object" }, allowsParallel: false, outboundDataClass: "workspace" }],
  limits: { maxModelTurns: 2, maxToolCalls: 4, maxChildCalls: 1, maxOutputTokens: 128, maxInputBytes: 4096, maxResultBytes: 4096, providerTimeoutMs: 5000, wallTimeMs: 10000 },
  signal: new AbortController().signal,
  emit: vi.fn(),
};

describe("OpenAI provider adapter", () => {
  it("normalizes Responses function calls without executing them", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer api-secret" });
      const body = JSON.parse(String(init?.body)) as { model: string; tools: unknown[] };
      expect(body.model).toBe("gpt-test");
      expect(body.tools).toHaveLength(1);
      return new Response(JSON.stringify({
        id: "resp-1",
        model: "gpt-test",
        output: [{ type: "function_call", call_id: "call-1", name: "readGoal", arguments: '{"goalId":"goal-1"}' }],
        usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = await createOpenAiPlugin({ fetch, resolveApiKey: async () => "api-secret", models: ["gpt-test"] }).create({
      model: { provider: "openai", id: "gpt-test" },
      account: { providerId: "openai", accountRef: "account-1", authMode: "api-key" },
      dataPolicyHash: "policy-1",
    });

    const result = await provider.turn(request);

    expect(result).toMatchObject({ model: { provider: "openai", id: "gpt-test" }, stopReason: "tool_use" });
    expect(result.toolCalls).toEqual([{ id: "call-1", name: "readGoal", arguments: { state: "valid", value: { goalId: "goal-1" } } }]);
    expect(result.usage).toEqual({ state: "available", totalTokens: 10 });
  });

  it("fails with a typed provider error without leaking the response body", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ secret: "do-not-log" }), { status: 401 }));
    const provider = await createOpenAiPlugin({ fetch, resolveApiKey: async () => "api-secret", models: ["gpt-test"] }).create({
      model: { provider: "openai", id: "gpt-test" },
      account: { providerId: "openai", accountRef: "account-1", authMode: "api-key" },
      dataPolicyHash: "policy-1",
    });
    await expect(provider.turn(request)).rejects.toMatchObject({ code: "provider_auth" });
  });
});
