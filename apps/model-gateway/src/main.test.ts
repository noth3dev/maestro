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
    expect(runtime.accountRefs).toEqual({ openai: "openai-operator-1", anthropic: "anthropic-operator-1", "openai-codex": "openai-codex-operator-1", "anthropic-claude": "anthropic-claude-operator-1" });
    await runtime.app.close();
  });

  it("does not fabricate a Codex model when dynamic discovery is unavailable", async () => {
    const runtime = createGatewayFromEnv({
      MAESTRO_MODEL_GATEWAY_TOKEN: "gateway-secret",
      MAESTRO_OPERATOR_ID: "operator-1",
      MAESTRO_CODEX_APP_SERVER_COMMAND: "/definitely-missing-maestro-codex",
    });
    const response = await runtime.app.inject({ method: "GET", url: "/v1/models", headers: { authorization: "Bearer gateway-secret" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "provider_unavailable" } });
    await runtime.app.close();
  });

  it("registers the Claude managed-subscription account ref by default and omits it when disabled", async () => {
    const enabled = createGatewayFromEnv({ MAESTRO_MODEL_GATEWAY_TOKEN: "gateway-secret", MAESTRO_OPERATOR_ID: "operator-1" });
    expect(enabled.accountRefs["anthropic-claude"]).toBe("anthropic-claude-operator-1");
    await enabled.app.close();

    const disabled = createGatewayFromEnv({ MAESTRO_MODEL_GATEWAY_TOKEN: "gateway-secret", MAESTRO_OPERATOR_ID: "operator-1", MAESTRO_CLAUDE_DISABLE: "true" });
    expect(disabled.accountRefs["anthropic-claude"]).toBeUndefined();
    await disabled.app.close();
  });

  it("fails closed when the gateway authentication token is absent", () => {
    expect(() => createGatewayFromEnv({ OPENAI_API_KEY: "secret" })).toThrow("gateway token");
  });
});
