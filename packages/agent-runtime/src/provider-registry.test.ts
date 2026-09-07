import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./provider-registry.js";
import type { ModelProviderPort, ProviderPlugin } from "./model-provider.js";

const fakeProvider = (provider: string, model = `${provider}/model-a`): ProviderPlugin => {
  const [providerId, id] = model.split("/");
  const identity = { provider: providerId!, id: id! };
  const port: ModelProviderPort = {
    identity,
    accountRef: "account-1",
    capabilities: new Set(["text"]),
    async turn() { throw new Error("not used"); },
    async cancel() { return { state: "unsupported" as const }; },
    async close() {},
  };
  return {
    id: provider,
    authModes: ["api-key"],
    capabilities: new Set(["text"]),
    dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainsOnCustomerData: false, regions: ["us"] },
    listModels: () => [{ identity, capabilities: new Set(["text"]), authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainsOnCustomerData: false, regions: ["us"] } }],
    create: async () => port,
  };
};

describe("ProviderRegistry", () => {
  it("rejects duplicate provider IDs and unknown providers", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("openai"));
    expect(() => registry.register(fakeProvider("openai"))).toThrow("duplicate provider id");
    expect(() => registry.resolve({ providerId: "missing", modelId: "model-a" })).toThrow("unknown provider");
  });

  it("resolves only an exact canonical model and declared capability", () => {
    const registry = new ProviderRegistry();
    registry.register(fakeProvider("openai"));
    expect(registry.resolveModel({ providerId: "openai", modelId: "model-a" })).toEqual({ provider: "openai", id: "model-a" });
    expect(() => registry.resolveModel({ providerId: "openai", modelId: "alias" })).toThrow("unknown model");
    expect(() => registry.requireCapabilities(fakeProvider("text-only"), ["tool-calls"])).toThrow("unsupported capability");
  });

  it("rejects a provider data policy that cannot carry the Goal data class", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.requireDataPolicy(fakeProvider("public-only"), { allowedDataClasses: ["workspace"], retention: "none", allowTraining: false, region: "us" })).toThrow("data policy");
  });
});
