import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelCatalogEntry, ModelGatewayPort } from "@maestro/agent-runtime";
import {
  MODEL_CAPABILITY_AXES,
  MODEL_CAPABILITY_SCHEMA_VERSION,
  MODEL_MAP_SCHEMA_VERSION,
  PROVIDER_FACTS_SCHEMA_VERSION,
  type ModelMapEntry,
} from "@maestro/domain";
import type { RouterConfigInput } from "@maestro/contracts";
import type { MaestroConfig } from "../config.js";
import { composeRouterCatalogService } from "./router-catalog.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  delete process.env.MAESTRO_MODEL_MAP;
});

function syntheticModelEntry(modelRef: string): ModelMapEntry {
  const axes = Object.fromEntries(
    MODEL_CAPABILITY_AXES.map((axis) => [
      axis,
      {
        status: "unproven",
        score: null,
        rationale: "Synthetic fixture; no model-specific capability evidence.",
        evidence: ["test-fixture:router-catalog"],
      },
    ]),
  ) as ModelMapEntry["capability"]["axes"];
  return {
    modelRef,
    capability: { schemaVersion: MODEL_CAPABILITY_SCHEMA_VERSION, axes },
    providerFacts: {
      schemaVersion: PROVIDER_FACTS_SCHEMA_VERSION,
      contextCapacity: 128_000,
      pricing: { inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
      authentication: { modes: ["api-key"] },
      dataPolicy: { allowedDataClasses: ["public"], retention: "none", trainingUse: "never", regions: ["test-only"] },
      modalities: ["text"],
      toolCalls: { supported: false },
      provenance: { source: "synthetic router-catalog test fixture", observedAt: "2026-09-24" },
    },
    provenance: { owner: "human", sourceRefs: ["test-fixture:router-catalog"], reviewedAt: "2026-09-24" },
  };
}

function modelFiles(entries: Array<{ modelRef: string; candidateRef?: string; accountBinding?: string }>): {
  modelMapPath: string;
  catalogPath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "maestro-router-catalog-"));
  directories.push(directory);
  const source = { schemaVersion: MODEL_MAP_SCHEMA_VERSION, entries: entries.map(({ modelRef }) => syntheticModelEntry(modelRef)) };
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
    expect(read.entries[0]).toMatchObject({
      candidate: { present: true },
      live: { present: false },
      state: "live-unavailable",
    });
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
    const settingsService = settings([]);
    const service = composeRouterCatalogService({
      pool: poolWith([]),
      config: config(join(tmpdir(), "does-not-exist-candidates.json")),
      modelGateway: undefined,
      settingsService,
    });
    const read = await service.get("operator-1");
    expect(read.status).toBe("inactive");
    expect(read.reason).toMatch(/candidate catalog/i);
    expect(read.reason).toMatch(/live gateway catalog/i);
    expect(read.reason).not.toContain("does-not-exist");

    const profiledRow = read.entries.find((entry) => entry.baseline.present);
    expect(profiledRow).toMatchObject({
      candidate: { present: null, candidateRefs: [], accountBindings: [] },
      live: { present: null, capabilities: [], authModes: [], regions: [] },
      inUse: false,
      state: "candidate-unknown",
    });
    expect(read.entries.filter((entry) => entry.baseline.present).every((entry) => entry.state !== "not-a-candidate")).toBe(true);
    const knownModelRef = profiledRow?.modelRef;
    expect(knownModelRef).toBeDefined();
    await expect(service.validate("operator-1", { schemaVersion: 1, enabledModelRefs: [knownModelRef!] })).resolves.toMatchObject({
      valid: true,
      unknownModelRefs: [],
      nonCandidateModelRefs: [],
      changes: [],
    });
    await service.replace("operator-1", { schemaVersion: 1, enabledModelRefs: [knownModelRef!] });
    expect(settingsService.replaceModelPool).toHaveBeenCalledWith("operator-1", {
      schemaVersion: 1,
      enabledModelRefs: [knownModelRef!],
    });

    const separator = knownModelRef!.indexOf("/");
    const liveRead = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(join(tmpdir(), "does-not-exist-candidates.json")),
      modelGateway: {
        listModels: async () => [gatewayModel(knownModelRef!.slice(0, separator), knownModelRef!.slice(separator + 1))],
      } as ModelGatewayPort,
      settingsService: settings([]),
    }).get("operator-1");
    expect(liveRead.entries.find((entry) => entry.modelRef === knownModelRef)).toMatchObject({
      candidate: { present: null },
      live: { present: true },
      state: "candidate-unknown",
    });
  });

  it("treats an empty but valid candidate catalog as known absence, not readiness", async () => {
    const modelRef = "openai/model-a";
    const files = modelFiles([{ modelRef }]);
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: { listModels: async () => [gatewayModel("openai", "model-a")] } as ModelGatewayPort,
      settingsService: settings([]),
    }).get("operator-1");

    expect(read.status).toBe("partial");
    expect(read.active).toBe(false);
    expect(read.reason).toContain("Candidate catalog is valid but contains no candidates");
    expect(read.entries.find((entry) => entry.modelRef === modelRef)).toMatchObject({
      baseline: { present: true },
      candidate: { present: false, candidateRefs: [], accountBindings: [] },
      live: { present: true },
      inUse: false,
      state: "not-a-candidate",
    });
  });

  it("preserves the empty-candidate reason when the live Gateway is also unavailable", async () => {
    const files = modelFiles([{ modelRef: "openai/model-a" }]);
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: undefined,
      settingsService: settings([]),
    }).get("operator-1");

    expect(read.status).toBe("partial");
    expect(read.active).toBe(false);
    expect(read.reason).toContain("Candidate catalog is valid but contains no candidates");
    expect(read.reason).toContain("Live Gateway catalog is unavailable");
  });

  it("does not report ready when a configured candidate is absent from the live Gateway", async () => {
    const files = modelFiles([
      { modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" },
      { modelRef: "openai/model-b", candidateRef: "candidate-b", accountBinding: "opaque-a" },
    ]);
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: { listModels: async () => [gatewayModel("openai", "model-a")] } as ModelGatewayPort,
      settingsService: settings([]),
    }).get("operator-1");
    expect(read.status).toBe("partial");
    expect(read.active).toBe(false);
    expect(read.reason).toMatch(/live|available/i);
  });

  it("does not report ready when a candidate account binding is not host-authorized", async () => {
    const files = modelFiles([{ modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "wrong-account" }]);
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: { listModels: async () => [gatewayModel("openai", "model-a")] } as ModelGatewayPort,
      settingsService: settings([]),
    }).get("operator-1");
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
    expect(read.entries[0]).toMatchObject({
      candidate: { present: true },
      live: { present: null, capabilities: [], authModes: [], regions: [] },
      state: "live-unknown",
    });

    const failedRead = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: {
        listModels: async () => {
          throw new Error("private gateway detail");
        },
      } as ModelGatewayPort,
      settingsService: settings([]),
    }).get("operator-1");
    expect(failedRead.entries[0]).toMatchObject({ live: { present: null }, state: "live-unknown" });
    expect(failedRead.reason).not.toContain("private gateway detail");
  });

  it("does not mark a profile-only row in use when the pool is unrestricted", async () => {
    const nonCandidateRef = "openai/model-b";
    const files = modelFiles([
      { modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" },
      { modelRef: nonCandidateRef },
    ]);
    const read = await composeRouterCatalogService({
      pool: poolWith([]),
      config: config(files.catalogPath),
      modelGateway: { listModels: async () => [gatewayModel("openai", "model-a"), gatewayModel("openai", "model-b")] } as ModelGatewayPort,
      settingsService: settings([]),
    }).get("operator-1");

    expect(read.entries.find((entry) => entry.modelRef === nonCandidateRef)).toMatchObject({
      baseline: { present: true },
      candidate: { present: false },
      inUse: false,
      state: "not-a-candidate",
    });
    expect(read.entries.find((entry) => entry.modelRef === "openai/model-a")?.inUse).toBe(true);
  });

  it("preserves profile-only refs as preferences without granting candidate membership", async () => {
    const candidateRef = "openai/model-a";
    const nonCandidateRef = "openai/model-b";
    const files = modelFiles([
      { modelRef: candidateRef, candidateRef: "candidate-a", accountBinding: "opaque-a" },
      { modelRef: nonCandidateRef },
    ]);
    let storedRefs = [candidateRef];
    const readPool = {
      query: async (sql: string) => {
        if (sql.startsWith("SELECT model_pool")) return { rows: [{ model_pool: { enabledModelRefs: [...storedRefs] } }] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as Pool;
    const serviceSettings = settings([]);
    serviceSettings.replaceModelPool.mockImplementation(async (_operatorId: string, input: RouterConfigInput) => {
      storedRefs = [...input.enabledModelRefs];
      return undefined as never;
    });
    const service = composeRouterCatalogService({
      pool: readPool,
      config: config(files.catalogPath),
      modelGateway: { listModels: async () => [gatewayModel("openai", "model-a"), gatewayModel("openai", "model-b")] } as ModelGatewayPort,
      settingsService: serviceSettings,
    });
    const input: RouterConfigInput = { schemaVersion: 1, enabledModelRefs: [candidateRef, nonCandidateRef] };
    await expect(service.validate("operator-1", input)).resolves.toMatchObject({
      valid: true,
      unknownModelRefs: [],
      nonCandidateModelRefs: [nonCandidateRef],
      changes: [],
    });
    const updated = await service.replace("operator-1", input);
    expect(updated.poolModelRefs).toEqual([candidateRef, nonCandidateRef].sort());
    expect(updated.entries.find((entry) => entry.modelRef === nonCandidateRef)).toMatchObject({
      baseline: { present: true },
      candidate: { present: false },
      inUse: false,
      state: "not-a-candidate",
    });
    expect(serviceSettings.replaceModelPool).toHaveBeenCalledOnce();
  });

  it("shows a live-only model but refuses to add it to the operator pool", async () => {
    const liveOnlyRef = "openai-codex/future-candidate";
    const files = modelFiles([{ modelRef: "openai/model-a", candidateRef: "candidate-a", accountBinding: "opaque-a" }]);
    const serviceSettings = settings(["openai/model-a"]);
    const service = composeRouterCatalogService({
      pool: poolWith(["openai/model-a"]),
      config: config(files.catalogPath),
      modelGateway: {
        listModels: async () => [gatewayModel("openai", "model-a"), gatewayModel("openai-codex", "future-candidate")],
      } as ModelGatewayPort,
      settingsService: serviceSettings,
    });

    const catalog = await service.get("operator-1");
    expect(catalog.entries.find((entry) => entry.modelRef === liveOnlyRef)).toMatchObject({
      baseline: { present: false, score: null },
      live: { present: true },
      candidate: { present: false },
      inUse: false,
      state: "unprofiled",
    });
    await expect(service.replace("operator-1", { schemaVersion: 1, enabledModelRefs: [liveOnlyRef] })).rejects.toMatchObject({
      name: "RouterConfigInvalidError",
      unknownModelRefs: [liveOnlyRef],
    });
    expect(serviceSettings.replaceModelPool).not.toHaveBeenCalled();
  });

  it("enables and disables an exact newly profiled candidate", async () => {
    const existingRef = "openai/model-a";
    const novelRef = "openai-codex/novel-model-2030";
    const files = modelFiles([
      { modelRef: existingRef, candidateRef: "candidate-a", accountBinding: "opaque-a" },
      { modelRef: novelRef, candidateRef: "candidate-future", accountBinding: "opaque-codex" },
    ]);
    let storedRefs = [existingRef];
    const readPool = {
      query: async (sql: string) => {
        if (sql.startsWith("SELECT model_pool")) return { rows: [{ model_pool: { enabledModelRefs: [...storedRefs] } }] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as Pool;
    const serviceSettings = settings([]);
    serviceSettings.replaceModelPool.mockImplementation(async (_operatorId: string, input: RouterConfigInput) => {
      storedRefs = [...input.enabledModelRefs];
      return undefined as never;
    });
    const service = composeRouterCatalogService({
      pool: readPool,
      config: config(files.catalogPath),
      modelGateway: {
        listModels: async () => [gatewayModel("openai", "model-a"), gatewayModel("openai-codex", "novel-model-2030")],
      } as ModelGatewayPort,
      settingsService: serviceSettings,
    });

    const enableInput: RouterConfigInput = { schemaVersion: 1, enabledModelRefs: [existingRef, novelRef] };
    await expect(service.validate("operator-1", enableInput)).resolves.toMatchObject({
      valid: true,
      unknownModelRefs: [],
      changes: [{ modelRef: novelRef, previousInUse: false, nextInUse: true }],
    });
    const enabled = await service.replace("operator-1", enableInput);
    expect(enabled.poolModelRefs).toEqual([existingRef, novelRef].sort());
    expect(enabled.entries.find((entry) => entry.modelRef === novelRef)).toMatchObject({
      baseline: { present: true, score: null },
      live: { present: true },
      candidate: { present: true, candidateRefs: ["candidate-future"], accountBindings: ["opaque-codex"] },
      inUse: true,
      state: "catalog-ready",
    });

    const disableInput: RouterConfigInput = { schemaVersion: 1, enabledModelRefs: [existingRef] };
    await expect(service.validate("operator-1", disableInput)).resolves.toMatchObject({
      valid: true,
      changes: [{ modelRef: novelRef, previousInUse: true, nextInUse: false }],
    });
    const disabled = await service.replace("operator-1", disableInput);
    expect(disabled.poolModelRefs).toEqual([existingRef]);
    expect(disabled.entries.find((entry) => entry.modelRef === novelRef)).toMatchObject({ inUse: false, state: "pool-disabled" });
    expect(serviceSettings.replaceModelPool).toHaveBeenCalledTimes(2);
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
