import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createPostgresSettingsService } from "./settings.js";

const models = [
  { modelRef: "model-a", score: 120 },
  { modelRef: "model-b", score: null },
];

function fakePool(
  options: {
    preferences?: unknown;
    modelPool?: unknown;
    spendCeilingCents?: string;
    criticalActionsRequireApproval?: boolean;
    allowFlashmob?: boolean;
    emptySelect?: boolean;
  } = {},
): Pool & { queries: { sql: string; values: readonly unknown[] | undefined }[] } {
  const queries: { sql: string; values: readonly unknown[] | undefined }[] = [];
  let modelPool = options.modelPool ?? {};
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    queries.push({ sql, values });
    if (sql.startsWith("INSERT INTO operator_settings")) return { rowCount: 1, rows: [] };
    if (sql.startsWith("UPDATE operator_settings")) {
      if (sql.includes("SET model_pool") && values?.[1] !== undefined) modelPool = JSON.parse(String(values[1]));
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("SELECT preferences, model_pool")) {
      if (options.emptySelect === true) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [
          {
            preferences: options.preferences ?? {},
            model_pool: modelPool,
            spend_ceiling_cents: options.spendCeilingCents ?? "5000",
            critical_actions_require_approval: options.criticalActionsRequireApproval ?? true,
            allow_flashmob: options.allowFlashmob ?? true,
          },
        ],
      };
    }
    if (sql.startsWith("SELECT spend_ceiling_cents")) {
      if (options.emptySelect === true) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [
          {
            spend_ceiling_cents: options.spendCeilingCents ?? "5000",
            critical_actions_require_approval: options.criticalActionsRequireApproval ?? true,
            allow_flashmob: options.allowFlashmob ?? true,
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query, queries } as unknown as Pool & { queries: { sql: string; values: readonly unknown[] | undefined }[] };
}

describe("createPostgresSettingsService", () => {
  it("merges stored preferences over defaults", async () => {
    const pool = fakePool({ preferences: { compactSidebar: true } });
    const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
    const read = await service.get("operator-1");
    expect(read.preferences).toEqual({ compactSidebar: true, desktopPush: true, emailDigest: false, slackWebhook: false });
  });

  it("marks every model in use when the pool allowlist is empty", async () => {
    const pool = fakePool();
    const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
    const read = await service.get("operator-1");
    expect(read.models).toEqual([
      { modelRef: "model-a", score: 120, inUse: true },
      { modelRef: "model-b", score: null, inUse: true },
    ]);
  });

  it("respects the stored model allowlist", async () => {
    const pool = fakePool({ modelPool: { enabledModelRefs: ["model-b", "unknown-ref"] } });
    const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
    const read = await service.get("operator-1");
    expect(read.models).toEqual([
      { modelRef: "model-a", score: 120, inUse: false },
      { modelRef: "model-b", score: null, inUse: true },
    ]);
  });

  it("throws a descriptive error when the settings row is missing after ensure", async () => {
    const pool = fakePool({ emptySelect: true });
    const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
    await expect(service.get("operator-1")).rejects.toThrow("operator settings row is missing after ensure");
    await expect(service.authorityDefaultsForOperator("operator-1")).rejects.toThrow("operator settings row is missing after ensure");
  });

  it("rejects model pool updates for refs outside the human-owned model map", async () => {
    const pool = fakePool();
    const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
    await expect(service.updateModelPool("operator-1", { modelRef: "model-zzz", inUse: true })).rejects.toThrow(
      "model is not present in the human-owned model_map",
    );
  });

  it("persists the updated allowlist sorted", async () => {
    const pool = fakePool({ modelPool: { enabledModelRefs: ["model-b"] } });
    const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
    const read = await service.updateModelPool("operator-1", { modelRef: "model-a", inUse: true });
    expect(read.models.filter((model) => model.inUse).map((model) => model.modelRef)).toEqual(["model-a", "model-b"]);
    const update = pool.queries.find((entry) => entry.sql.startsWith("UPDATE operator_settings SET model_pool"));
    expect(JSON.parse(String(update?.values?.[1]))).toEqual({ enabledModelRefs: ["model-a", "model-b"] });
  });

  it("persists disabling a model from the allowlist", async () => {
    const pool = fakePool({ modelPool: { enabledModelRefs: ["model-a", "model-b"] } });
    const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
    const read = await service.updateModelPool("operator-1", { modelRef: "model-a", inUse: false });
    expect(read.models.filter((model) => model.inUse).map((model) => model.modelRef)).toEqual(["model-b"]);
    const update = pool.queries.find((entry) => entry.sql.startsWith("UPDATE operator_settings SET model_pool"));
    expect(JSON.parse(String(update?.values?.[1]))).toEqual({ enabledModelRefs: ["model-b"] });
  });

  it("coerces authority defaults from stored text", async () => {
    const pool = fakePool({ spendCeilingCents: "2500", criticalActionsRequireApproval: false, allowFlashmob: false });
    const service = createPostgresSettingsService({ pool, models: { list: async () => models } });
    await expect(service.authorityDefaultsForOperator("operator-1")).resolves.toEqual({
      spendCeilingCents: 2500,
      criticalActionsRequireApproval: false,
      allowFlashmob: false,
    });
  });
});
