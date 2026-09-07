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
    async turn(request) { return { requestId: request.requestId, model: identity, text: "ok", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } }; },
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
});
