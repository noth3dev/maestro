import { afterEach, describe, expect, it } from "vitest";
import { ProviderRegistry, ToolRegistry, type ModelProviderPort, type ProviderPlugin } from "@maestro/agent-runtime";
import { InMemoryCredentialStore } from "../../model-gateway/src/credential-store.js";
import { createModelGateway } from "../../model-gateway/src/gateway.js";
import { buildModelGatewayServer } from "../../model-gateway/src/rpc.js";
import { createModelGatewayClient } from "./model-gateway-client.js";
import { createNativeExecutionKernel } from "./native-execution-kernel.js";
import type { ExecutionAdmission } from "@maestro/domain";

function fakePlugin(): ProviderPlugin {
  const identity = { provider: "fake", id: "model-a" };
  const dataPolicy = { allowedDataClasses: ["public"] as const, retention: "none" as const, trainsOnCustomerData: false, regions: ["us"] };
  const port: ModelProviderPort = {
    identity, accountRef: "account-1", capabilities: new Set(["text"]),
    async turn(request) {
      request.emit({ kind: "text-delta", cursor: 1, text: "native" });
      return { requestId: request.requestId, model: identity, text: "native gateway reply", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
    },
    async cancel() { return { state: "confirmed" as const }; },
    async close() {},
  };
  return { id: "fake", authModes: ["api-key"], capabilities: new Set(["text"]), dataPolicy, listModels: () => [{ identity, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy }], create: async (request) => ({ ...port, accountRef: request.account.accountRef }) };
}

describe("native execution over the real Model Gateway HTTP server", () => {
  let closeGateway: (() => Promise<void>) | undefined;
  afterEach(async () => { await closeGateway?.(); closeGateway = undefined; });

  it("admits, prompts, observes, and closes a native worker through TCP", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.bind({ operatorId: "operator-1", providerId: "fake", authMode: "api-key", accountRef: "account-1" }, "provider-secret");
    const registry = new ProviderRegistry(); registry.register(fakePlugin());
    const gateway = createModelGateway({ registry, credentials, operatorId: "operator-1", instanceId: "gateway-http-test" });
    const app = buildModelGatewayServer({ gateway, token: "gateway-secret", operatorId: "operator-1" });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new Error("gateway did not bind TCP");
    const client = createModelGatewayClient({ baseUrl: `http://127.0.0.1:${address.port}`, token: "gateway-secret" });
    const kernel = createNativeExecutionKernel({ gateway: client, gatewayOperatorId: "operator-1", accountRefs: { fake: "account-1" }, dataPolicyHash: "policy-native-http", tools: new ToolRegistry() });
    closeGateway = async () => { await kernel.close(); await app.close(); await gateway.close(); };
    const admission: ExecutionAdmission = {
      context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1", accountRef: "account-1" },
      grant: { grantId: "grant-1", allowedTools: [], allowedSkills: [], modelPolicy: ["fake/model-a"], pathScope: [], outboundDataClasses: ["public"], remaining: { modelTurns: 2, toolCalls: 0, childCalls: 0, outputTokens: 1024, wallTimeMs: 10_000, retryCount: 0 } },
      modelPolicy: ["fake/model-a"], idempotencyKey: "worker-command-1",
    };
    const spawned = await kernel.spawn({ name: "worker:exec-1", cwd: process.cwd(), ...admission });
    await kernel.prompt(spawned.execution, "Return the bounded result.");
    const [observation] = await kernel.observe(spawned.execution);
    expect(observation?.status).toBe("succeeded");
    expect(observation?.answer).toEqual({ state: "available", text: "native gateway reply" });
    expect(await kernel.getModelIdentity(spawned.execution)).toEqual({ provider: "fake", id: "model-a" });
    expect(JSON.stringify(admission)).not.toContain("provider-secret");
  });
});
