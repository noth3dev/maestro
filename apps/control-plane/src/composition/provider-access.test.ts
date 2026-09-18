import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ModelCatalogEntry, ModelGatewayPort } from "@maestro/agent-runtime";
import type { MaestroConfig } from "../config.js";
import { composeProviderCredentials, composeSettingsService } from "./provider-access.js";

const fsControl = vi.hoisted(() => ({ mode: "ok" as "ok" | "throw" }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const isModelMapPath = (path: unknown): boolean => typeof path === "string" && path.replace(/\\/g, "/").endsWith("config/model_map.json");
  return {
    ...actual,
    readFileSync: (path: never, options?: never) => {
      if (isModelMapPath(path)) {
        if (fsControl.mode === "throw") throw new Error("EACCES: permission denied");
        return JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              modelRef: "openai/gpt-5.6-sol",
              capability: { axes: { reasoning: { status: "scored", score: 140 }, coding: { status: "scored", score: 150 } } },
            },
            { modelRef: "anthropic/claude-sonnet-5", capability: { axes: { reasoning: { status: "unproven", score: null } } } },
            { capability: { axes: {} } },
          ],
        });
      }
      return (actual.readFileSync as (...args: never[]) => string)(path, options);
    },
  };
});

const GATEWAY_OPERATOR = "gateway-operator";
const config = { modelGatewayOperatorId: GATEWAY_OPERATOR } as MaestroConfig;

function catalogEntry(provider: string, id: string, authModes: ("api-key" | "managed-subscription")[]): ModelCatalogEntry {
  return {
    identity: { provider, id },
    capabilities: new Set(["text"]),
    authModes,
    dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["US"] },
  } as ModelCatalogEntry;
}

function fakeGateway(overrides: Partial<ModelGatewayPort> = {}): ModelGatewayPort {
  return {
    listModels: vi.fn(async () => [
      catalogEntry("openai", "gpt-5.6-sol", ["api-key"]),
      catalogEntry("openai", "gpt-5.6-sol", ["managed-subscription"]),
      catalogEntry("anthropic", "claude-sonnet-5", ["api-key"]),
    ]),
    bindCredential: vi.fn(async (request) => ({
      bindingId: "binding-1",
      providerId: request.providerId,
      accountRef: "account-1",
      authMode: "api-key",
      configuredAt: "2026-09-18T00:00:00.000Z",
    })),
    revokeCredential: vi.fn(async () => undefined),
    startAccountLogin: vi.fn(async () => ({
      providerId: "openai-codex" as const,
      loginId: "login-1",
      authUrl: "https://example.test/login",
    })),
    accountLoginStatus: vi.fn(async (request) => ({
      providerId: "openai-codex" as const,
      loginId: request.loginId,
      state: "pending" as const,
    })),
    cancelAccountLogin: vi.fn(async () => undefined),
    logoutAccount: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ModelGatewayPort;
}

function fakePool() {
  const row = {
    preferences: {},
    model_pool: {},
    spend_ceiling_cents: "5000",
    critical_actions_require_approval: true,
    allow_flashmob: true,
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("INSERT INTO operator_settings")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("SELECT preferences, model_pool")) return { rowCount: 1, rows: [{ ...row }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as unknown as Pool;
}

describe("composeSettingsService", () => {
  it("lists gateway providers through the fixed gateway operator identity", async () => {
    const gateway = fakeGateway();
    const service = composeSettingsService({ pool: fakePool(), config, modelGateway: gateway });
    const read = await service.get("operator-1");
    expect(gateway.listModels).toHaveBeenCalledWith({ operatorId: GATEWAY_OPERATOR });
    const byProvider = new Map(read.providers.map((provider) => [provider.providerId, [...provider.authModes].sort()]));
    expect(byProvider.get("openai")).toEqual(["api-key", "managed-subscription"]);
    expect(byProvider.get("anthropic")).toEqual(["api-key"]);
    expect(read.providers.every((provider) => provider.connected)).toBe(true);
  });

  it("reports no providers without a gateway", async () => {
    const service = composeSettingsService({ pool: fakePool(), config, modelGateway: undefined });
    const read = await service.get("operator-1");
    expect(read.providers).toEqual([]);
  });

  it("parses the human-owned model map into averaged scores and filters entries without modelRef", async () => {
    fsControl.mode = "ok";
    const service = composeSettingsService({ pool: fakePool(), config, modelGateway: fakeGateway() });
    const read = await service.get("operator-1");
    expect(read.models).toEqual([
      { modelRef: "openai/gpt-5.6-sol", score: 145, inUse: true },
      { modelRef: "anthropic/claude-sonnet-5", score: null, inUse: true },
    ]);
  });

  it("returns no models when the model map cannot be read", async () => {
    fsControl.mode = "throw";
    try {
      const service = composeSettingsService({ pool: fakePool(), config, modelGateway: fakeGateway() });
      const read = await service.get("operator-1");
      expect(read.models).toEqual([]);
    } finally {
      fsControl.mode = "ok";
    }
  });
});

describe("composeProviderCredentials", () => {
  it("is absent without a gateway or without bind/revoke capability", () => {
    expect(composeProviderCredentials({ pool: fakePool(), config, modelGateway: undefined })).toBeUndefined();
    const { bindCredential: _bind, ...noBind } = fakeGateway();
    expect(composeProviderCredentials({ pool: fakePool(), config, modelGateway: noBind as ModelGatewayPort })).toBeUndefined();
    const { revokeCredential: _revoke, ...noRevoke } = fakeGateway();
    expect(composeProviderCredentials({ pool: fakePool(), config, modelGateway: noRevoke as ModelGatewayPort })).toBeUndefined();
  });

  it("forwards bind and revoke with the fixed gateway operator identity, never the caller", async () => {
    const gateway = fakeGateway();
    const service = composeProviderCredentials({ pool: fakePool(), config, modelGateway: gateway })!;
    await service.bind({
      operatorId: "caller-operator",
      requestId: "request-1",
      providerId: "openai",
      authMode: "api-key",
      secret: "secret",
    });
    expect(gateway.bindCredential).toHaveBeenCalledWith({
      operatorId: GATEWAY_OPERATOR,
      requestId: "request-1",
      providerId: "openai",
      authMode: "api-key",
      secret: "secret",
    });
    await service.revoke({ operatorId: "caller-operator", requestId: "request-2", providerId: "openai" });
    expect(gateway.revokeCredential).toHaveBeenCalledWith({ operatorId: GATEWAY_OPERATOR, requestId: "request-2", providerId: "openai" });
  });

  it("folds gateway models into connected providers", async () => {
    const gateway = fakeGateway();
    const service = composeProviderCredentials({ pool: fakePool(), config, modelGateway: gateway })!;
    const providers = await service.list!();
    expect(gateway.listModels).toHaveBeenCalledWith({ operatorId: GATEWAY_OPERATOR });
    expect(providers.every((provider) => provider.connected)).toBe(true);
    expect(new Map(providers.map((provider) => [provider.providerId, [...provider.authModes].sort()]))).toEqual(
      new Map([
        ["openai", ["api-key", "managed-subscription"]],
        ["anthropic", ["api-key"]],
      ]),
    );
  });

  it("keeps the shared fold identical across the settings and credentials surfaces", async () => {
    const gateway = fakeGateway();
    const pool = fakePool();
    const settingsProviders = (await composeSettingsService({ pool, config, modelGateway: gateway }).get("operator-1")).providers;
    const credentialProviders = await composeProviderCredentials({ pool, config, modelGateway: gateway })!.list!();
    expect(credentialProviders).toEqual(settingsProviders);
  });

  it("keeps the account-login surface without logoutAccount when the gateway lacks only that", () => {
    const { logoutAccount: _logout, ...noLogout } = fakeGateway();
    const service = composeProviderCredentials({ pool: fakePool(), config, modelGateway: noLogout as ModelGatewayPort })!;
    expect(typeof service.startAccountLogin).toBe("function");
    expect(typeof service.accountLoginStatus).toBe("function");
    expect(typeof service.cancelAccountLogin).toBe("function");
    expect(service.logoutAccount).toBeUndefined();
  });

  it("exposes the full account-login surface including optional logoutAccount on a full gateway", () => {
    const service = composeProviderCredentials({ pool: fakePool(), config, modelGateway: fakeGateway() })!;
    expect(typeof service.startAccountLogin).toBe("function");
    expect(typeof service.accountLoginStatus).toBe("function");
    expect(typeof service.cancelAccountLogin).toBe("function");
    expect(typeof service.logoutAccount).toBe("function");
  });

  it.each(["startAccountLogin", "accountLoginStatus", "cancelAccountLogin"] as const)(
    "hides the whole account-login surface when %s is missing",
    (missing) => {
      const gateway = fakeGateway();
      (gateway as unknown as Record<string, unknown>)[missing] = undefined;
      const service = composeProviderCredentials({ pool: fakePool(), config, modelGateway: gateway })!;
      expect(service.startAccountLogin).toBeUndefined();
      expect(service.accountLoginStatus).toBeUndefined();
      expect(service.cancelAccountLogin).toBeUndefined();
    },
  );

  it("forwards account-login calls with the fixed gateway operator identity", async () => {
    const gateway = fakeGateway();
    const service = composeProviderCredentials({ pool: fakePool(), config, modelGateway: gateway })!;
    await service.startAccountLogin!({ operatorId: "caller-operator", requestId: "request-1", providerId: "openai-codex" });
    expect(gateway.startAccountLogin).toHaveBeenCalledWith({
      operatorId: GATEWAY_OPERATOR,
      requestId: "request-1",
      providerId: "openai-codex",
    });
    await service.accountLoginStatus!({
      operatorId: "caller-operator",
      requestId: "request-1",
      providerId: "openai-codex",
      loginId: "login-1",
    });
    expect(gateway.accountLoginStatus).toHaveBeenCalledWith({
      operatorId: GATEWAY_OPERATOR,
      requestId: "request-1",
      providerId: "openai-codex",
      loginId: "login-1",
    });
    await service.cancelAccountLogin!({
      operatorId: "caller-operator",
      requestId: "request-1",
      providerId: "openai-codex",
      loginId: "login-1",
    });
    expect(gateway.cancelAccountLogin).toHaveBeenCalledWith({
      operatorId: GATEWAY_OPERATOR,
      requestId: "request-1",
      providerId: "openai-codex",
      loginId: "login-1",
    });
    await service.logoutAccount!({ operatorId: "caller-operator", requestId: "request-2", providerId: "openai-codex" });
    expect(gateway.logoutAccount).toHaveBeenCalledWith({
      operatorId: GATEWAY_OPERATOR,
      requestId: "request-2",
      providerId: "openai-codex",
    });
  });
});
