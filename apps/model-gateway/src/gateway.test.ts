import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "@maestro/agent-runtime";
import type { ModelProviderPort, ProviderPlugin } from "@maestro/agent-runtime";
import { InMemoryCredentialStore } from "./credential-store.js";
import { createModelGateway } from "./gateway.js";

function fakePlugin(): ProviderPlugin {
  const identity = { provider: "fake", id: "model-a" };
  const port: ModelProviderPort = {
    identity, accountRef: "account-1", capabilities: new Set(["text"]),
    async turn(request) { return { requestId: request.requestId, model: identity, text: "ok", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } }; },
    async cancel() { return { state: "confirmed" as const }; },
    async close() {},
  };
  return {
    id: "fake", authModes: ["api-key"], capabilities: new Set(["text"]),
    dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainsOnCustomerData: false, regions: ["us"] },
    listModels: () => [{ identity, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainsOnCustomerData: false, regions: ["us"] } }],
    create: async (request) => ({ ...port, accountRef: request.account.accountRef }),
  };
}

describe("model gateway", () => {
  it("keeps raw credentials out of bindings and enforces operator ownership", async () => {
    const store = new InMemoryCredentialStore();
    const binding = await store.bind({ operatorId: "operator-1", providerId: "fake", authMode: "api-key" }, "secret");
    expect(JSON.stringify(binding)).not.toContain("secret");
    await expect(store.resolve(binding.accountRef, "operator-2", "fake")).rejects.toThrow("credential binding");
    await expect(store.resolve(binding.accountRef, "operator-1", "fake")).resolves.toBe("secret");
  });

  it("exposes only models backed by an active operator credential", async () => {
    const credentials = new InMemoryCredentialStore();
    const registry = new ProviderRegistry();
    registry.register(fakePlugin());
    const gateway = createModelGateway({ registry, credentials, operatorId: "operator-1", instanceId: "gateway-1" });

    await expect(gateway.listModels({ operatorId: "operator-1" })).resolves.toEqual([]);
    await credentials.bind({ operatorId: "operator-1", providerId: "fake", authMode: "api-key", accountRef: "account-1" }, "secret");
    await expect(gateway.listModels({ operatorId: "operator-1" })).resolves.toHaveLength(1);
    await expect(gateway.listModels({ operatorId: "operator-2" })).resolves.toEqual([]);
  });

  it("admits an exact provider/model/account binding and delegates turns", async () => {
    const credentials = new InMemoryCredentialStore();
    const account = await credentials.bind({ operatorId: "operator-1", providerId: "fake", authMode: "api-key" }, "secret");
    const registry = new ProviderRegistry();
    registry.register(fakePlugin());
    const gateway = createModelGateway({ registry, credentials, operatorId: "operator-1", instanceId: "gateway-1" });
    const binding = await gateway.admit({ requestId: "admit-1", operatorId: "operator-1", providerId: "fake", model: { provider: "fake", id: "model-a" }, accountRef: account.accountRef, dataPolicyHash: "policy-1" });
    const result = await gateway.turn({
      binding, requestId: "request-1", sessionId: "session-1", turnId: "turn-1", messages: [], tools: [],
      limits: { maxModelTurns: 1, maxToolCalls: 0, maxChildCalls: 0, maxOutputTokens: 8, maxInputBytes: 1024, maxResultBytes: 1024, providerTimeoutMs: 1000, wallTimeMs: 1000 },
      signal: new AbortController().signal, emit: () => {},
    });
    expect(result.text).toBe("ok");
    expect((await gateway.recover(binding))).toBe("reconnected");
  });
});


describe("managed account login", () => {
  it("binds only metadata after the Codex app-server reports success", async () => {
    const registry = new ProviderRegistry();
    const credentials = new InMemoryCredentialStore();
    const codex = {
      startChatGptLogin: async () => ({ providerId: "openai-codex" as const, loginId: "login-1", authUrl: "https://chatgpt.com/login" }),
      loginStatus: async () => ({ loginId: "login-1", state: "succeeded" as const }),
      cancelLogin: async () => {},
    };
    const gateway = createModelGateway({ registry, credentials, operatorId: "operator-1", instanceId: "gateway-1", codex });
    await expect(gateway.startAccountLogin?.({ requestId: "r1", operatorId: "operator-1", providerId: "openai-codex" })).resolves.toEqual({ providerId: "openai-codex", loginId: "login-1", authUrl: "https://chatgpt.com/login" });
    await expect(gateway.accountLoginStatus?.({ requestId: "r2", operatorId: "operator-1", providerId: "openai-codex", loginId: "login-1" })).resolves.toEqual({ providerId: "openai-codex", loginId: "login-1", state: "succeeded" });
    const binding = await credentials.ensure("openai-codex-operator-1");
    expect(binding).toMatchObject({ providerId: "openai-codex", authMode: "managed-subscription" });
    await expect(credentials.resolveForGateway("openai-codex-operator-1")).rejects.toThrow("no gateway secret");
  });
});


it("logs out of the managed account and revokes its metadata binding", async () => {
  const registry = new ProviderRegistry();
  const credentials = new InMemoryCredentialStore();
  await credentials.bindManaged({ operatorId: "operator-1", providerId: "openai-codex", accountRef: "openai-codex-operator-1" });
  let loggedOut = false;
  const codex = { startChatGptLogin: async () => ({ providerId: "openai-codex" as const, loginId: "login-1", authUrl: "https://chatgpt.com/login" }), loginStatus: async () => ({ loginId: "login-1", state: "succeeded" as const }), cancelLogin: async () => {}, logout: async () => { loggedOut = true; }, close: async () => {} };
  const gateway = createModelGateway({ registry, credentials, operatorId: "operator-1", instanceId: "gateway-1", codex });
  await expect(gateway.logoutAccount?.({ requestId: "r1", operatorId: "operator-1", providerId: "openai-codex" })).resolves.toBeUndefined();
  expect(loggedOut).toBe(true);
  await expect(credentials.ensure("openai-codex-operator-1")).resolves.toBeUndefined();
});
