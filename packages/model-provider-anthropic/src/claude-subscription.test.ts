import { describe, expect, it, vi } from "vitest";
import { createClaudeSubscriptionPlugin } from "./claude-subscription.js";
import type { ModelTurnRequest } from "@maestro/agent-runtime";

const request: ModelTurnRequest = {
  requestId: "request-1",
  sessionId: "session-1",
  turnId: "turn-1",
  messages: [{ role: "user", content: [{ kind: "text", text: "show the Goal" }] }],
  tools: [
    {
      name: "readGoal",
      version: "1",
      description: "Read Goal",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      allowsParallel: false,
      outboundDataClass: "workspace",
    },
  ],
  limits: {
    maxModelTurns: 2,
    maxToolCalls: 4,
    maxChildCalls: 1,
    maxOutputTokens: 128,
    maxInputBytes: 4096,
    maxResultBytes: 4096,
    providerTimeoutMs: 5000,
    wallTimeMs: 10000,
  },
  signal: new AbortController().signal,
  emit: vi.fn(),
};

describe("Claude subscription provider adapter", () => {
  it("authenticates with a Bearer OAuth token and the oauth-2025-04-20 beta header instead of x-api-key", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer real-access-token",
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-version": "2023-06-01",
      });
      expect(init?.headers).not.toHaveProperty("x-api-key");
      const body = JSON.parse(String(init?.body)) as { model: string; tools: unknown[]; max_tokens: number };
      expect(body.model).toBe("claude-test");
      expect(body.max_tokens).toBe(128);
      expect(body.tools).toHaveLength(1);
      return new Response(
        JSON.stringify({
          model: "claude-test",
          content: [{ type: "tool_use", id: "toolu-1", name: "readGoal", input: { goalId: "goal-1" } }],
          usage: { input_tokens: 7, output_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = await createClaudeSubscriptionPlugin({
      fetch,
      resolveAccessToken: async (accountRef) => {
        expect(accountRef).toBe("account-1");
        return { accessToken: "real-access-token" };
      },
      models: ["claude-test"],
    }).create({
      model: { provider: "anthropic-claude", id: "claude-test" },
      account: { providerId: "anthropic-claude", accountRef: "account-1", authMode: "managed-subscription" },
      dataPolicyHash: "policy-1",
    });

    const result = await provider.turn(request);

    expect(result).toMatchObject({ model: { provider: "anthropic-claude", id: "claude-test" }, stopReason: "tool_use" });
    expect(result.toolCalls).toEqual([{ id: "toolu-1", name: "readGoal", arguments: { state: "valid", value: { goalId: "goal-1" } } }]);
    expect(result.usage).toEqual({ state: "available", totalTokens: 10 });
  });

  it("does not expose error response bodies", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ secret: "do-not-log" }), { status: 429 }));
    const provider = await createClaudeSubscriptionPlugin({
      fetch,
      resolveAccessToken: async () => ({ accessToken: "t" }),
      models: ["claude-test"],
    }).create({
      model: { provider: "anthropic-claude", id: "claude-test" },
      account: { providerId: "anthropic-claude", accountRef: "account-1", authMode: "managed-subscription" },
      dataPolicyHash: "policy-1",
    });
    await expect(provider.turn(request)).rejects.toMatchObject({ code: "provider_quota" });
  });

  it("rejects account/model binding mismatches", async () => {
    const plugin = createClaudeSubscriptionPlugin({ resolveAccessToken: async () => ({ accessToken: "t" }), models: ["claude-test"] });
    await expect(
      plugin.create({
        model: { provider: "anthropic-claude", id: "claude-test" },
        account: { providerId: "openai-codex", accountRef: "account-1", authMode: "managed-subscription" },
        dataPolicyHash: "policy-1",
      }),
    ).rejects.toMatchObject({ code: "provider_auth" });
  });
});
