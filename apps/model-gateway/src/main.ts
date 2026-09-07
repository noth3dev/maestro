import { createOpenAiPlugin } from "@maestro/model-provider-openai";
import { createAnthropicPlugin } from "@maestro/model-provider-anthropic";
import { ProviderRegistry } from "@maestro/agent-runtime";
import { KeychainCredentialStore } from "./credential-store.js";
import { createModelGateway } from "./gateway.js";
import { buildModelGatewayServer } from "./rpc.js";

export interface ModelGatewayRuntime {
  readonly app: ReturnType<typeof buildModelGatewayServer>;
  readonly gateway: ReturnType<typeof createModelGateway>;
  readonly accountRefs: Readonly<Record<string, string>>;
}

function modelsFromEnv(value: string | undefined, fallback: string): readonly string[] {
  const models = (value ?? fallback).split(",").map((model) => model.trim()).filter(Boolean);
  return models.length > 0 ? models : [fallback];
}

export function createGatewayFromEnv(env: NodeJS.ProcessEnv): ModelGatewayRuntime {
  const token = env.MAESTRO_MODEL_GATEWAY_TOKEN;
  if (!token) throw new Error("model gateway token is required");
  const operatorId = env.MAESTRO_OPERATOR_ID ?? "local-operator";
  const credentials = new KeychainCredentialStore(env.MAESTRO_MODEL_GATEWAY_CREDENTIAL_SERVICE ?? "maestro-model-gateway");
  const registry = new ProviderRegistry();
  const accountRefs: Record<string, string> = {};
  const openAiAccountRef = `openai-${operatorId}`;
  const anthropicAccountRef = `anthropic-${operatorId}`;
  accountRefs.openai = openAiAccountRef;
  accountRefs.anthropic = anthropicAccountRef;
  // Register provider adapters independently from credentials. The gateway
  // filters discovery and admission by the active operator-owned binding.
  registry.register(createOpenAiPlugin({ models: modelsFromEnv(env.OPENAI_MODELS, "gpt-5"), resolveApiKey: (ref) => credentials.resolveForGateway(ref) }));
  registry.register(createAnthropicPlugin({ models: modelsFromEnv(env.ANTHROPIC_MODELS, "claude-sonnet-4-5"), resolveApiKey: (ref) => credentials.resolveForGateway(ref) }));
  const initialBindings = Promise.all([
    env.OPENAI_API_KEY ? credentials.bindEphemeral!({ operatorId, providerId: "openai", authMode: "api-key", accountRef: openAiAccountRef }, env.OPENAI_API_KEY) : undefined,
    env.ANTHROPIC_API_KEY ? credentials.bindEphemeral!({ operatorId, providerId: "anthropic", authMode: "api-key", accountRef: anthropicAccountRef }, env.ANTHROPIC_API_KEY) : undefined,
  ]).then(() => undefined);
  const gateway = createModelGateway({ registry, credentials, operatorId, ready: initialBindings, instanceId: env.MAESTRO_MODEL_GATEWAY_INSTANCE_ID ?? `gateway-${process.pid}` });
  return { app: buildModelGatewayServer({ gateway, token, operatorId }), gateway, accountRefs };
}

export async function startModelGateway(env = process.env): Promise<{ close: () => Promise<void> }> {
  const runtime = createGatewayFromEnv(env);
  await runtime.app.listen({ host: env.MAESTRO_MODEL_GATEWAY_HOST ?? "127.0.0.1", port: Number(env.MAESTRO_MODEL_GATEWAY_PORT ?? "4321") });
  return { close: () => runtime.app.close() };
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  void startModelGateway().catch(() => {
    console.error("Model gateway failed to start");
    process.exitCode = 1;
  });
}
