import { CodexAppServerClient, CodexOAuthClient, createCodexAppServerPlugin, createCodexResponsesPlugin, createOpenAiPlugin } from "@maestro/model-provider-openai";
import { createAnthropicPlugin, ClaudeOAuthClient, createClaudeSubscriptionPlugin } from "@maestro/model-provider-anthropic";
import { ProviderRegistry } from "@maestro/agent-runtime";
import { createCodexAccessTokenResolver } from "./codex-token-resolver.js";
import { createClaudeAccessTokenResolver } from "./claude-token-resolver.js";
import { adoptExistingCodexLogin } from "./codex-login-adoption.js";
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

function optionalModelsFromEnv(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(",").map((model) => model.trim()).filter(Boolean);
}

function positiveMilliseconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  // ChatGPT Codex support defaults to the native OAuth + Responses API path
  // (no external `codex` executable required, and real tool-bearing turns
  // work, unlike the app-server JSON-RPC bridge below). Set
  // MAESTRO_CODEX_APP_SERVER_COMMAND to explicitly opt into the legacy
  // subprocess bridge instead, or MAESTRO_CODEX_DISABLE=true to disable
  // Codex support entirely.
  const codexCommand = env.MAESTRO_CODEX_APP_SERVER_COMMAND?.trim();
  const codexAccountRef = `openai-codex-${operatorId}`;
  const codexModels = optionalModelsFromEnv(env.MAESTRO_CODEX_MODELS);
  let codex: CodexAppServerClient | CodexOAuthClient | undefined;
  let codexLoginAdoption: Promise<unknown> | undefined;
  if (env.MAESTRO_CODEX_DISABLE !== "true") {
    if (codexCommand !== undefined && codexCommand !== "") {
      const client = new CodexAppServerClient({ command: codexCommand, args: ["app-server"], requestTimeoutMs: positiveMilliseconds(env.MAESTRO_CODEX_APP_SERVER_TIMEOUT_MS, 30000) });
      codex = client;
      codexLoginAdoption = adoptExistingCodexLogin({ client, credentials, operatorId, accountRef: codexAccountRef });
      accountRefs["openai-codex"] = codexAccountRef;
      registry.register(createCodexAppServerPlugin({ client, ...(codexModels === undefined ? {} : { models: codexModels }) }));
    } else {
      const oauth = new CodexOAuthClient();
      codex = oauth;
      accountRefs["openai-codex"] = codexAccountRef;
      registry.register(createCodexResponsesPlugin({
        resolveAccessToken: createCodexAccessTokenResolver({ credentials, operatorId, refresh: (refreshToken) => oauth.refresh(refreshToken) }),
        ...(codexModels === undefined ? {} : { models: codexModels }),
      }));
    }
  }
  // Anthropic Claude Pro/Max support: native OAuth + Messages API path, same
  // shape as the Codex OAuth branch above. Set MAESTRO_CLAUDE_DISABLE=true to
  // disable Claude account-login support entirely.
  const claudeAccountRef = `anthropic-claude-${operatorId}`;
  const claudeModels = optionalModelsFromEnv(env.MAESTRO_CLAUDE_MODELS);
  let claude: ClaudeOAuthClient | undefined;
  if (env.MAESTRO_CLAUDE_DISABLE !== "true") {
    const oauth = new ClaudeOAuthClient();
    claude = oauth;
    accountRefs["anthropic-claude"] = claudeAccountRef;
    registry.register(createClaudeSubscriptionPlugin({
      resolveAccessToken: createClaudeAccessTokenResolver({ credentials, operatorId, refresh: (refreshToken) => oauth.refresh(refreshToken) }),
      ...(claudeModels === undefined ? {} : { models: claudeModels }),
    }));
  }
  // Register provider adapters independently from credentials. The gateway
  // filters discovery and admission by the active operator-owned binding.
  registry.register(createOpenAiPlugin({ models: modelsFromEnv(env.OPENAI_MODELS, "gpt-5"), resolveApiKey: (ref) => credentials.resolveForGateway(ref) }));
  registry.register(createAnthropicPlugin({ models: modelsFromEnv(env.ANTHROPIC_MODELS, "claude-sonnet-4-5"), resolveApiKey: (ref) => credentials.resolveForGateway(ref) }));
  const initialBindings = Promise.all([
    env.OPENAI_API_KEY ? credentials.bindEphemeral!({ operatorId, providerId: "openai", authMode: "api-key", accountRef: openAiAccountRef }, env.OPENAI_API_KEY) : undefined,
    env.ANTHROPIC_API_KEY ? credentials.bindEphemeral!({ operatorId, providerId: "anthropic", authMode: "api-key", accountRef: anthropicAccountRef }, env.ANTHROPIC_API_KEY) : undefined,
    codexLoginAdoption,
  ]).then(() => undefined);
  const gateway = createModelGateway({ registry, credentials, ...(codex === undefined ? {} : { codex }), ...(claude === undefined ? {} : { claude }), operatorId, ready: initialBindings, instanceId: env.MAESTRO_MODEL_GATEWAY_INSTANCE_ID ?? `gateway-${process.pid}` });
  return { app: buildModelGatewayServer({ gateway, token, operatorId }), gateway, accountRefs };
}

export async function startModelGateway(env = process.env): Promise<{ close: () => Promise<void> }> {
  const runtime = createGatewayFromEnv(env);
  await runtime.app.listen({ host: env.MAESTRO_MODEL_GATEWAY_HOST ?? "127.0.0.1", port: Number(env.MAESTRO_MODEL_GATEWAY_PORT ?? "4321") });
  return { close: async () => { await runtime.app.close(); await runtime.gateway.close(); } };
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  void startModelGateway().catch(() => {
    console.error("Model gateway failed to start");
    process.exitCode = 1;
  });
}
