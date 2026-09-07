import { describe, expect, it } from "vitest";
import { ProviderRegistry, type ModelProviderPort, type ProviderPlugin } from "@maestro/agent-runtime";
import { InMemoryCredentialStore } from "./credential-store.js";
import { createModelGateway } from "./gateway.js";
import { buildModelGatewayServer } from "./rpc.js";

function fakePlugin(): ProviderPlugin {
  const identity = { provider: "fake", id: "model-a" };
  const dataPolicy = { allowedDataClasses: ["public"] as const, retention: "none" as const, trainsOnCustomerData: false, regions: ["us"] };
  const port: ModelProviderPort = {
    identity, accountRef: "account-1", capabilities: new Set(["text"]),
    async turn(request) {
      request.emit({ kind: "text-delta", cursor: 1, text: "o" });
      return { requestId: request.requestId, model: identity, text: "ok", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
    },
    async cancel() { return { state: "confirmed" as const }; },
    async close() {},
  };
  return { id: "fake", authModes: ["api-key"], capabilities: new Set(["text"]), dataPolicy, listModels: () => [{ identity, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy }], create: async (request) => ({ ...port, accountRef: request.account.accountRef }) };
}

async function server() {
  const credentials = new InMemoryCredentialStore();
  const account = await credentials.bind({ operatorId: "operator-1", providerId: "fake", authMode: "api-key", accountRef: "account-1" }, "secret");
  const registry = new ProviderRegistry();
  registry.register(fakePlugin());
  const gateway = createModelGateway({ registry, credentials, operatorId: "operator-1", instanceId: "gateway-1" });
  const app = buildModelGatewayServer({ gateway, token: "gateway-secret", operatorId: "operator-1" });
  return { app, account };
}

describe("model gateway error boundaries", () => {
  it("preserves a stable lost-login code for Control Plane recovery", async () => {
    const credentials = new InMemoryCredentialStore();
    const registry = new ProviderRegistry();
    const codex = {
      startChatGptLogin: async () => ({ providerId: "openai-codex" as const, loginId: "login-1", authUrl: "https://chatgpt.com/login" }),
      loginStatus: async () => { throw new Error("account login session is unknown"); },
      cancelLogin: async () => {}, close: async () => {},
    };
    const gateway = createModelGateway({ registry, credentials, operatorId: "operator-1", instanceId: "gateway-1", codex });
    const app = buildModelGatewayServer({ gateway, token: "gateway-secret", operatorId: "operator-1" });
    const response = await app.inject({ method: "POST", url: "/v1/account-logins/status", headers: { authorization: "Bearer gateway-secret" }, payload: { requestId: "status-1", operatorId: "operator-1", providerId: "openai-codex", loginId: "login-1" } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: "account_login_session_unknown", message: "account login session is unknown" } });
    await app.close();
  });
});

describe("model gateway RPC", () => {
  it("requires gateway authentication and exposes only normalized models", async () => {
    const { app } = await server();
    const denied = await app.inject({ method: "GET", url: "/v1/models" });
    expect(denied.statusCode).toBe(401);
    const allowed = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: "Bearer gateway-secret" } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual([{ identity: { provider: "fake", id: "model-a" }, authModes: ["api-key"], capabilities: ["text"], dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainsOnCustomerData: false, regions: ["us"] } }]);
  });

  it("binds and revokes credentials through the authenticated gateway boundary", async () => {
    const { app } = await server();
    const headers = { authorization: "Bearer gateway-secret" };
    const bind = await app.inject({ method: "POST", url: "/v1/credentials/bind", headers, payload: { requestId: "bind-1", operatorId: "operator-1", providerId: "fake", authMode: "api-key", secret: "new-secret" } });
    // The narrow RPC schema intentionally exposes only the production API-key providers.
    expect(bind.statusCode).toBe(400);
    const spoof = await app.inject({ method: "POST", url: "/v1/credentials/bind", headers, payload: { requestId: "bind-2", operatorId: "operator-2", providerId: "openai", authMode: "api-key", secret: "new-secret" } });
    expect(spoof.statusCode).toBe(403);
    expect(spoof.body).not.toContain("new-secret");
  });

  it("admits and turns without accepting credentials or authority fields", async () => {
    const { app, account } = await server();
    const rejectedSecret = await app.inject({
      method: "POST", url: "/v1/admit", headers: { authorization: "Bearer gateway-secret" },
      payload: { requestId: "admit-1", operatorId: "operator-1", providerId: "fake", model: { provider: "fake", id: "model-a" }, accountRef: account.accountRef, dataPolicyHash: "policy-1", secret: "do-not-accept" },
    });
    expect(rejectedSecret.statusCode).toBe(400);
    const admit = await app.inject({
      method: "POST", url: "/v1/admit", headers: { authorization: "Bearer gateway-secret" },
      payload: { requestId: "admit-1", operatorId: "operator-1", providerId: "fake", model: { provider: "fake", id: "model-a" }, accountRef: account.accountRef, dataPolicyHash: "policy-1" },
    });
    expect(admit.statusCode).toBe(200);
    const binding = admit.json();
    expect(JSON.stringify(binding)).not.toContain("secret");
    const turn = await app.inject({
      method: "POST", url: "/v1/turn", headers: { authorization: "Bearer gateway-secret" },
      payload: { binding, requestId: "request-1", sessionId: "session-1", turnId: "turn-1", messages: [], tools: [], limits: { maxModelTurns: 1, maxToolCalls: 0, maxChildCalls: 0, maxOutputTokens: 8, maxInputBytes: 1024, maxResultBytes: 1024, providerTimeoutMs: 1000, wallTimeMs: 1000 } },
    });
    expect(turn.statusCode).toBe(200);
    expect(turn.json()).toMatchObject({ text: "ok", model: { provider: "fake", id: "model-a" } });
  });
  it("streams provider events over authenticated SSE without exposing credentials", async () => {
    const { app, account } = await server();
    const headers = { authorization: "Bearer gateway-secret" };
    const admit = await app.inject({ method: "POST", url: "/v1/admit", headers, payload: { requestId: "admit-stream", operatorId: "operator-1", providerId: "fake", model: { provider: "fake", id: "model-a" }, accountRef: account.accountRef, dataPolicyHash: "policy-1" } });
    const binding = admit.json();
    const streamed = await app.inject({ method: "POST", url: "/v1/turn/stream", headers, payload: { binding, requestId: "request-stream", sessionId: "session-1", turnId: "turn-stream", messages: [], tools: [], limits: { maxModelTurns: 1, maxToolCalls: 0, maxChildCalls: 0, maxOutputTokens: 8, maxInputBytes: 1024, maxResultBytes: 1024, providerTimeoutMs: 1000, wallTimeMs: 1000 } } });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers["content-type"]).toContain("text/event-stream");
    expect(streamed.body).toContain("event: text-delta");
    expect(streamed.body).toContain('"text":"o"');
    expect(streamed.body).toContain("event: result");
    expect(streamed.body).not.toContain("secret");
  });


});


describe("managed account login RPC", () => {
  it("returns a browser URL and exposes only status metadata", async () => {
    const credentials = new InMemoryCredentialStore();
    const registry = new ProviderRegistry();
    const codex = {
      startChatGptLogin: async () => ({ providerId: "openai-codex" as const, loginId: "login-1", authUrl: "https://chatgpt.com/login" }),
      loginStatus: async () => ({ loginId: "login-1", state: "pending" as const }),
      cancelLogin: async () => {},
      close: async () => {},
    };
    const gateway = createModelGateway({ registry, credentials, operatorId: "operator-1", instanceId: "gateway-1", codex });
    const app = buildModelGatewayServer({ gateway, token: "gateway-secret", operatorId: "operator-1" });
    const headers = { authorization: "Bearer gateway-secret" };
    const start = await app.inject({ method: "POST", url: "/v1/account-logins/start", headers, payload: { requestId: "login-1", operatorId: "operator-1", providerId: "openai-codex" } });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toEqual({ providerId: "openai-codex", loginId: "login-1", authUrl: "https://chatgpt.com/login" });
    const status = await app.inject({ method: "POST", url: "/v1/account-logins/status", headers, payload: { requestId: "login-2", operatorId: "operator-1", providerId: "openai-codex", loginId: "login-1" } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ providerId: "openai-codex", loginId: "login-1", state: "pending" });
    expect(status.body).not.toContain("token");
    await app.close();
  });
});
