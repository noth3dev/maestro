import type { Pool } from "pg";
import type { ModelGatewayPort } from "@maestro/agent-runtime";
import { createPostgresSettingsService } from "@maestro/persistence";
import type { MaestroConfig } from "../config.js";
import type { ProviderCredentialService } from "../server.js";
import { readModelMapSource } from "./model-map-source.js";

type GatewayModel = Awaited<ReturnType<NonNullable<ModelGatewayPort["listModels"]>>>[number];

function foldProviderModes(
  models: readonly GatewayModel[],
): { providerId: string; connected: boolean; authModes: ("api-key" | "managed-subscription")[] }[] {
  const providers = new Map<string, Set<"api-key" | "managed-subscription">>();
  for (const model of models) {
    const modes = providers.get(model.identity.provider) ?? new Set<"api-key" | "managed-subscription">();
    for (const mode of model.authModes) modes.add(mode);
    providers.set(model.identity.provider, modes);
  }
  return [...providers.entries()].map(([providerId, modes]) => ({ providerId, connected: true, authModes: [...modes] }));
}

export interface ProviderAccessDeps {
  pool: Pool;
  config: MaestroConfig;
  modelGateway?: ModelGatewayPort | undefined;
}

export function composeSettingsService(deps: ProviderAccessDeps): ReturnType<typeof createPostgresSettingsService> {
  const { pool, config, modelGateway } = deps;
  return createPostgresSettingsService({
    pool,
    models: {
      list: async () => {
        try {
          return readModelMapSource().modelMap.entries.map((entry) => {
            const values = Object.values(entry.capability.axes).flatMap((axis) =>
              axis.status === "scored" && axis.score !== null ? [axis.score] : [],
            );
            return {
              modelRef: entry.modelRef,
              score: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
            };
          });
        } catch {
          return [];
        }
      },
    },
    providers: {
      list: async () => {
        if (modelGateway?.listModels === undefined) return [];
        return foldProviderModes(await modelGateway.listModels({ operatorId: config.modelGatewayOperatorId }));
      },
    },
  });
}

// The Model Gateway process authenticates one fixed gateway-level
// operator identity (config.modelGatewayOperatorId), matching exactly
// how native admission already calls gateway.admit() with
// gatewayOperatorId rather than the calling end-user's own operator ID
// (apps/control-plane/src/native-execution-kernel.ts). Provider
// credentials and managed logins are shared per Control-Plane process,
// not per individual Maestro operator; the real end-user's identity and
// authorization remain enforced entirely by Maestro's own persistence
// layer (accountLoginStore, project membership, roles), which still
// receives and scopes by the real operatorId untouched. Forwarding the
// real end-user operatorId to the gateway's own operatorId-equality
// check instead of this fixed constant made every credential bind and
// every account-login call fail closed with "credential operator
// context mismatch" for any authenticated operator whose ID is not
// literally equal to the configured gateway operator ID -- i.e. always,
// for every real multi-operator deployment.
export function composeProviderCredentials(deps: ProviderAccessDeps): ProviderCredentialService | undefined {
  const { config, modelGateway } = deps;
  if (modelGateway === undefined || modelGateway.bindCredential === undefined || modelGateway.revokeCredential === undefined) {
    return undefined;
  }
  const gateway = modelGateway;
  return {
    bind: (input: { operatorId: string; requestId: string; providerId: "openai" | "anthropic"; authMode: "api-key"; secret: string }) =>
      gateway.bindCredential!({ ...input, operatorId: config.modelGatewayOperatorId }),
    revoke: (input: { operatorId: string; requestId: string; providerId: "openai" | "anthropic" }) =>
      gateway.revokeCredential!({ ...input, operatorId: config.modelGatewayOperatorId }),
    // A gateway without listModels cannot back reads: omit list so the route
    // fail-closes (DurableStoreUnavailableError), mirroring the all-or-none
    // account-login surface below.
    ...(gateway.listModels === undefined
      ? {}
      : { list: async () => foldProviderModes(await gateway.listModels!({ operatorId: config.modelGatewayOperatorId })) }),
    ...(gateway.startAccountLogin === undefined || gateway.accountLoginStatus === undefined || gateway.cancelAccountLogin === undefined
      ? {}
      : {
          startAccountLogin: (input: { operatorId: string; requestId: string; providerId: "openai-codex" | "anthropic-claude" }) =>
            gateway.startAccountLogin!({ ...input, operatorId: config.modelGatewayOperatorId }),
          accountLoginStatus: (input: {
            operatorId: string;
            requestId: string;
            providerId: "openai-codex" | "anthropic-claude";
            loginId: string;
          }) => gateway.accountLoginStatus!({ ...input, operatorId: config.modelGatewayOperatorId }),
          cancelAccountLogin: (input: {
            operatorId: string;
            requestId: string;
            providerId: "openai-codex" | "anthropic-claude";
            loginId: string;
          }) => gateway.cancelAccountLogin!({ ...input, operatorId: config.modelGatewayOperatorId }),
          ...(gateway.logoutAccount === undefined
            ? {}
            : {
                logoutAccount: (input: { operatorId: string; requestId: string; providerId: "openai-codex" | "anthropic-claude" }) =>
                  gateway.logoutAccount!({ ...input, operatorId: config.modelGatewayOperatorId }),
              }),
        }),
  };
}
