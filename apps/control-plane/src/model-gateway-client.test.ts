import { describe, expect, it } from "vitest";
import type { ModelCatalogEntry, ModelTurnResult } from "@maestro/agent-runtime";
import { createModelGatewayClient } from "./model-gateway-client.js";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const model: ModelCatalogEntry = {
  identity: { provider: "openai", id: "gpt-test" }, capabilities: new Set(["text"]), authModes: ["api-key"],
  dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainsOnCustomerData: false, regions: ["us"] },
};

describe("Control Plane model gateway client", () => {
  it("sends only the authenticated narrow gateway request and normalizes model sets", async () => {
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:4321/v1/models");
      expect(init?.headers).toMatchObject({ authorization: "Bearer gateway-secret" });
      return response([{ ...model, capabilities: ["text"] }]);
    };
    const client = createModelGatewayClient({ baseUrl: "http://127.0.0.1:4321", token: "gateway-secret", fetch });
    const models = await client.listModels({ operatorId: "operator-1" });
    expect(models[0]?.capabilities).toEqual(new Set(["text"]));
  });

  it("maps provider errors without leaking response bodies", async () => {
    const fetch = async () => response({ secret: "do-not-leak" }, 503);
    const client = createModelGatewayClient({ baseUrl: "http://127.0.0.1:4321", token: "gateway-secret", fetch });
    await expect(client.listModels({ operatorId: "operator-1" })).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(client.listModels({ operatorId: "operator-1" })).rejects.not.toThrow("do-not-leak");
  });

  it("sanitizes gateway stream errors and bounds incomplete records", async () => {
    const errorFetch = async () => new Response(`event: error\ndata: ${JSON.stringify({ code: "provider_secret_leak", message: "Bearer provider-secret-token" })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    const client = createModelGatewayClient({ baseUrl: "http://127.0.0.1:4321", token: "gateway-secret", fetch: errorFetch });
    const input = { binding: { bindingId: "binding-1", gatewayInstanceId: "gateway-1", provider: model.identity, account: { providerId: "openai", accountRef: "account-1", authMode: "api-key" as const }, dataPolicyHash: "policy-1" }, requestId: "request-1", sessionId: "session-1", turnId: "turn-1", messages: [], tools: [], limits: { maxModelTurns: 1, maxToolCalls: 0, maxChildCalls: 0, maxOutputTokens: 8, maxInputBytes: 1024, maxResultBytes: 1024, providerTimeoutMs: 1000, wallTimeMs: 1000 }, signal: new AbortController().signal, emit: () => {} };
    await expect(client.turn(input)).rejects.toMatchObject({ code: "provider_unavailable", message: "model gateway stream failed" });

    const oversized = createModelGatewayClient({ baseUrl: "http://127.0.0.1:4321", token: "gateway-secret", fetch: async () => new Response("x".repeat(128_001), { status: 200, headers: { "content-type": "text/event-stream" } }) });
    await expect(oversized.turn(input)).rejects.toMatchObject({ code: "gateway_request_failed", message: "model gateway stream record is too large" });
  });

  it("rejects a stale streamed result with a different request identity", async () => {
    const fetch = async () => new Response([`event: result\ndata: ${JSON.stringify({ requestId: "stale-request", model: model.identity, text: "stale", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } })}\n\n`].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    const client = createModelGatewayClient({ baseUrl: "http://127.0.0.1:4321", token: "gateway-secret", fetch });
    const input = { binding: { bindingId: "binding-1", gatewayInstanceId: "gateway-1", provider: model.identity, account: { providerId: "openai", accountRef: "account-1", authMode: "api-key" as const }, dataPolicyHash: "policy-1" }, requestId: "request-1", sessionId: "session-1", turnId: "turn-1", messages: [], tools: [], limits: { maxModelTurns: 1, maxToolCalls: 0, maxChildCalls: 0, maxOutputTokens: 8, maxInputBytes: 1024, maxResultBytes: 1024, providerTimeoutMs: 1000, wallTimeMs: 1000 }, signal: new AbortController().signal, emit: () => {} };

    await expect(client.turn(input)).rejects.toMatchObject({ code: "gateway_request_failed", message: "model gateway returned a mismatched request" });
  });

  it("forwards provider stream events and returns the terminal result", async () => {
    const result: ModelTurnResult = { requestId: "request-1", model: model.identity, text: "ok", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:4321/v1/turn/stream");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty("signal");
      expect(body).not.toHaveProperty("emit");
      return new Response([
        `event: text-delta\ndata: ${JSON.stringify({ kind: "text-delta", cursor: 1, text: "ok" })}\n\n`,
        `event: result\ndata: ${JSON.stringify(result)}\n\n`,
      ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const events: string[] = [];
    const client = createModelGatewayClient({ baseUrl: "http://127.0.0.1:4321", token: "gateway-secret", fetch });
    const actual = await client.turn({ binding: { bindingId: "binding-1", gatewayInstanceId: "gateway-1", provider: model.identity, account: { providerId: "openai", accountRef: "account-1", authMode: "api-key" }, dataPolicyHash: "policy-1" }, requestId: "request-1", sessionId: "session-1", turnId: "turn-1", messages: [], tools: [], limits: { maxModelTurns: 1, maxToolCalls: 0, maxChildCalls: 0, maxOutputTokens: 8, maxInputBytes: 1024, maxResultBytes: 1024, providerTimeoutMs: 1000, wallTimeMs: 1000 }, signal: new AbortController().signal, emit: (event) => events.push(event.kind) });
    expect(actual.text).toBe("ok");
    expect(events).toEqual(["text-delta"]);
  });
});


it("preserves the gateway lost-login code for restart recovery", async () => {
  const fetch = async () => response({ error: { code: "account_login_session_unknown", message: "account login session is unknown" } }, 409);
  const client = createModelGatewayClient({ baseUrl: "http://127.0.0.1:4321", token: "gateway-secret", fetch });
  await expect(client.accountLoginStatus?.({ requestId: "request-unknown", operatorId: "operator-1", providerId: "openai-codex", loginId: "login-1" })).rejects.toMatchObject({ code: "account_login_session_unknown", message: "account login session is unknown" });
});

it("starts and polls managed account login through the narrow gateway RPC", async () => {
  const paths: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    paths.push(String(input));
    expect(init?.headers).toMatchObject({ authorization: "Bearer gateway-secret" });
    if (String(input).endsWith("/account-logins/start")) return response({ providerId: "openai-codex", loginId: "login-1", authUrl: "https://chatgpt.com/login" });
    return response({ providerId: "openai-codex", loginId: "login-1", state: "succeeded" });
  };
  const client = createModelGatewayClient({ baseUrl: "http://127.0.0.1:4321", token: "gateway-secret", fetch });
  await expect(client.startAccountLogin?.({ requestId: "request-1", operatorId: "operator-1", providerId: "openai-codex" })).resolves.toEqual({ providerId: "openai-codex", loginId: "login-1", authUrl: "https://chatgpt.com/login" });
  await expect(client.accountLoginStatus?.({ requestId: "request-2", operatorId: "operator-1", providerId: "openai-codex", loginId: "login-1" })).resolves.toEqual({ providerId: "openai-codex", loginId: "login-1", state: "succeeded" });
  expect(paths).toEqual(["http://127.0.0.1:4321/v1/account-logins/start", "http://127.0.0.1:4321/v1/account-logins/status"]);
});
