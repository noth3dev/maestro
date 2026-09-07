import { describe, expect, it } from "vitest";
import { createGatewayFromEnv } from "./main.js";

describe("model gateway environment composition", () => {
  it("registers configured API-key providers without exposing their keys", async () => {
    const runtime = createGatewayFromEnv({
      MAESTRO_MODEL_GATEWAY_TOKEN: "gateway-secret",
      MAESTRO_OPERATOR_ID: "operator-1",
      OPENAI_API_KEY: "openai-secret",
      OPENAI_MODELS: "gpt-test,gpt-small",
      ANTHROPIC_API_KEY: "anthropic-secret",
      ANTHROPIC_MODELS: "claude-test",
    });
    const response = await runtime.app.inject({ method: "GET", url: "/v1/models", headers: { authorization: "Bearer gateway-secret" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((model: { identity: { provider: string; id: string } }) => `${model.identity.provider}/${model.identity.id}`)).toEqual(["openai/gpt-test", "openai/gpt-small", "anthropic/claude-test"]);
    expect(runtime.accountRefs).toEqual({ openai: "openai-operator-1", anthropic: "anthropic-operator-1" });
    await runtime.app.close();
  });

  it("fails closed when the gateway authentication token is absent", () => {
    expect(() => createGatewayFromEnv({ OPENAI_API_KEY: "secret" })).toThrow("gateway token");
  });
});
