import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelCatalogEntry, ModelGatewayPort } from "@maestro/agent-runtime";
import type { MaestroConfig } from "../config.js";
import { composeRouterCatalogService } from "./router-catalog.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  delete process.env.MAESTRO_MODEL_MAP;
});

function modelFiles(entries: Array<{ modelRef: string; candidateRef?: string; accountBinding?: string }>): {
  modelMapPath: string;
  catalogPath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "maestro-router-catalog-"));
  directories.push(directory);
  const source = JSON.parse(readFileSync(join(process.cwd(), "config/model_map.json"), "utf8")) as {
    schemaVersion: 1;
    entries: Array<Record<string, unknown>>;
  };
  source.entries = entries.map(({ modelRef }) => ({ ...source.entries[0], modelRef }));
  const modelMapPath = join(directory, "model_map.json");
  const catalogPath = join(directory, "candidates.json");
  writeFileSync(modelMapPath, JSON.stringify(source), "utf8");
  writeFileSync(
    catalogPath,
    JSON.stringify({
      schemaVersion: 1,
      entries: entries
        .filter((entry) => entry.candidateRef !== undefined)
        .map((entry) => ({ candidateRef: entry.candidateRef, modelRef: entry.modelRef, accountBinding: entry.accountBinding })),
    }),
    "utf8",
  );
  process.env.MAESTRO_MODEL_MAP = modelMapPath;
  return { modelMapPath, catalogPath };
}

function gatewayModel(provider: string, id: string): ModelCatalogEntry {
  return {
    identity: { provider, id },
    capabilities: new Set(["text"]),
    authModes: ["api-key"],
    dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainsOnCustomerData: false, regions: ["US"] },
  };
}

function poolWith(refs: readonly string[]): Pool {
  return {
    query: async (sql: string) => {
      if (sql.startsWith("SELECT model_pool")) return { rows: [{ model_pool: { enabledModelRefs: [...refs] } }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Pool;
}

function config(catalogPath?: string): MaestroConfig {
  return {
    modelRoutingMode: "ensemble",
    modelGatewayOperatorId: "operator-1",
    modelAccountRefs: { openai: "opaque-a", "openai-codex": "opaque-codex" },
    ...(catalogPath === undefined ? {} : { ensembleCandidateCatalogPath: catalogPath }),
  } as MaestroConfig;
}

function settings(pool: readonly string[]) {
  return { replaceModelPool: vi.fn(), pool };
}

describe("Router catalog composition", () => {
  it("keeps openai and openai-codex exact identities separate", async () => {
    const files = modelFiles([
      { modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" },
      { modelRef: "openai-codex/model-a", candidateRef: "candidate-codex", accountBinding: "opaque-codex" },
    ]);
    const gateway: ModelGatewayPort = {
      listModels: async () => [gatewayModel("openai", "model-a"), gatewayModel("openai-codex", "model-a")],
    } as ModelGatewayPort;
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: gateway,
      settingsService: settings([]),
    }).get("operator-1");
    expect(read.entries.map((entry) => entry.modelRef)).toEqual(["openai/model-a", "openai-codex/model-a"]);
    expect(new Set(read.entries.map((entry) => entry.providerId))).toEqual(new Set(["openai", "openai-codex"]));
  });

  it("derives unprofiled, not-a-candidate, pool-disabled, and catalog-ready states", async () => {
    const files = modelFiles([
      { modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" },
      { modelRef: "openai/model-b" },
    ]);
    const gateway: ModelGatewayPort = {
      listModels: async () => [gatewayModel("openai", "model-a"), gatewayModel("openai", "live-only")],
    } as ModelGatewayPort;
    const read = await composeRouterCatalogService({
      pool: poolWith(["openai/model-a"]),
      config: config(files.catalogPath),
      modelGateway: gateway,
      settingsService: settings(["openai/model-a"]),
    }).get("operator-1");
    expect(read.entries.find((entry) => entry.modelRef === "openai/model-a")?.state).toBe("catalog-ready");
    expect(read.entries.find((entry) => entry.modelRef === "openai/model-b")?.state).toBe("not-a-candidate");
    expect(read.entries.find((entry) => entry.modelRef === "openai/live-only")?.state).toBe("unprofiled");
  });

  it("reports pool-disabled before live-unavailable", async () => {
    const files = modelFiles([{ modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" }]);
    const gateway: ModelGatewayPort = { listModels: async () => [] } as ModelGatewayPort;
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: gateway,
      settingsService: settings([]),
    }).get("operator-1");
    expect(read.entries[0]?.state).toBe("live-unavailable");
    const disabled = await composeRouterCatalogService({
      pool: poolWith(["openai/other"]),
      config: config(files.catalogPath),
      modelGateway: gateway,
      settingsService: settings(["openai/other"]),
    }).get("operator-1");
    expect(disabled.entries[0]?.state).toBe("pool-disabled");
  });

  it("fails closed with an inactive status when the candidate catalog is unavailable", async () => {
    process.env.MAESTRO_MODEL_MAP = join(process.cwd(), "config/model_map.json");
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(join(tmpdir(), "does-not-exist-candidates.json")),
      modelGateway: undefined,
      settingsService: settings([]),
    }).get("operator-1");
    expect(read.status).toBe("inactive");
    expect(read.reason).toMatch(/candidate catalog/i);
    expect(read.reason).not.toContain("does-not-exist");
  });

  it("does not report ready when a configured candidate is absent from the live Gateway", async () => {
    const files = modelFiles([
      { modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" },
      { modelRef: "openai/model-b", candidateRef: "candidate-b", accountBinding: "opaque-a" },
    ]);
    const read = await composeRouterCatalogService({ pool: poolWith([]), config: config(files.catalogPath), modelGateway: { listModels: async () => [gatewayModel("openai", "model-a")] } as ModelGatewayPort, settingsService: settings([]) }).get("operator-1");
    expect(read.status).toBe("partial");
    expect(read.active).toBe(false);
    expect(read.reason).toMatch(/live|available/i);
  });

  it("does not report ready when a candidate account binding is not host-authorized", async () => {
    const files = modelFiles([{ modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "wrong-account" }]);
    const read = await composeRouterCatalogService({ pool: poolWith([]), config: config(files.catalogPath), modelGateway: { listModels: async () => [gatewayModel("openai", "model-a")] } as ModelGatewayPort, settingsService: settings([]) }).get("operator-1");
    expect(read.status).toBe("partial");
    expect(read.active).toBe(false);
    expect(read.reason).toMatch(/account|binding/i);
  });

  it("returns partial when live Gateway data is unavailable", async () => {
    const files = modelFiles([{ modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" }]);
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: undefined,
      settingsService: settings([]),
    }).get("operator-1");
    expect(read.status).toBe("partial");
    expect(read.entries[0]?.state).toBe("live-unavailable");
  });

  it("validates unknown refs without mutating the operator pool", async () => {
    const files = modelFiles([{ modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" }]);
    const serviceSettings = settings(["openai/model-a"]);
    const readPool = poolWith(["openai/model-a"]);
    const service = composeRouterCatalogService({
      pool: readPool,
      config: config(files.catalogPath),
      modelGateway: undefined,
      settingsService: serviceSettings,
    });
    await expect(service.validate("operator-1", { schemaVersion: 1, enabledModelRefs: ["unknown/model"] })).resolves.toMatchObject({
      valid: false,
      unknownModelRefs: ["unknown/model"],
    });
    expect(serviceSettings.replaceModelPool).not.toHaveBeenCalled();
  });
});
