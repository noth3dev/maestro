import { describe, expect, it, vi } from "vitest";
import type { SettingsRead } from "@maestro/contracts";
import { createSettingsStore, formatCents, raisesAuthority, redactSecret, safeErrorMessage, type SettingsApi } from "./settings-data.js";

const savedSettings: SettingsRead = {
  preferences: { compactSidebar: false, desktopPush: true, emailDigest: false, slackWebhook: false },
  authorityDefaults: { spendCeilingCents: 1000, criticalActionsRequireApproval: true, allowFlashmob: false },
  models: [{ modelRef: "openai/gpt-5", score: 90, inUse: true }],
  providers: [{ providerId: "openai", connected: true, authModes: ["api-key"] }],
};

function api(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    getSettings: vi.fn(async () => savedSettings),
    updateSettingsPreferences: vi.fn(async () => savedSettings),
    updateSettingsModelPool: vi.fn(async () => savedSettings),
    updateSettingsAuthorityDefaults: vi.fn(async () => savedSettings),
    listModels: vi.fn(async () => []),
    listProviderConnections: vi.fn(async () => []),
    loginProvider: vi.fn(async () => ({ bindingId: "binding", accountRef: "account", providerId: "openai" as const, authMode: "api-key" as const, configuredAt: "2026-09-23T00:00:00.000Z" })),
    logoutProvider: vi.fn(async () => undefined),
    getBudgetSummary: vi.fn(async () => ({ goalId: "11111111-1111-4111-8111-111111111111", projectId: "22222222-2222-4222-8222-222222222222", budgetCents: 1000, reservedCents: 400, costCents: 200 })),
    getBillingSummary: vi.fn(async () => { throw new Error("unused"); }),
    ...overrides,
  };
}

describe("settings data", () => {
  it("uses the server response as the saved state instead of optimistic input", async () => {
    const server = { ...savedSettings, preferences: { ...savedSettings.preferences, compactSidebar: true } };
    const client = api({ updateSettingsPreferences: vi.fn(async () => server) });
    const store = createSettingsStore(client);
    await store.load();
    const result = await store.updatePreferences({ compactSidebar: false });
    expect(result).toBe(server);
    expect(store.getSaved()).toBe(server);
  });

  it("replaces stale state on a fresh server load", async () => {
    const server = { ...savedSettings, authorityDefaults: { ...savedSettings.authorityDefaults, spendCeilingCents: 2400 } };
    const client = api({ getSettings: vi.fn(async () => server) });
    const store = createSettingsStore(client);
    await store.load();
    expect(store.getSaved()?.authorityDefaults.spendCeilingCents).toBe(2400);
  });

  it("keeps the previous saved state when a write fails", async () => {
    const client = api({ updateSettingsPreferences: vi.fn(async () => { throw new Error("write failed"); }) });
    const store = createSettingsStore(client);
    await store.load();
    await expect(store.updatePreferences({ compactSidebar: true })).rejects.toThrow("write failed");
    expect(store.getSaved()).toBe(savedSettings);
  });

  it("requires confirmation only when a default increases authority", () => {
    expect(raisesAuthority(savedSettings.authorityDefaults, { spendCeilingCents: 1200 })).toBe(true);
    expect(raisesAuthority(savedSettings.authorityDefaults, { spendCeilingCents: 900 })).toBe(false);
    expect(raisesAuthority(savedSettings.authorityDefaults, { criticalActionsRequireApproval: false })).toBe(true);
    expect(raisesAuthority(savedSettings.authorityDefaults, { allowFlashmob: true })).toBe(true);
  });

  it("does not retain provider secrets in the settings store", async () => {
    const client = api();
    const store = createSettingsStore(client);
    await store.loginProvider({ providerId: "openai", authMode: "api-key", secret: ["super", "secret"].join("-") });
    expect(store.getSaved()).toBeUndefined();
    expect(JSON.stringify(store)).not.toContain(["super", "secret"].join("-"));
  });

  it("redacts provider secrets from user-facing failures", () => {
    const secret = ["super", "secret"].join("-");
    expect(redactSecret(`provider rejected ${secret}`, secret)).toBe("provider rejected [redacted]");
  });

  it("sanitizes credential-shaped error text before it reaches the UI", () => {
    const bearer = ["super", "secret"].join("-");
    const token = ["other", "secret"].join("-");
    expect(safeErrorMessage(new Error(`Bearer ${bearer} token=${token}`), "request failed")).toBe("Bearer [redacted] token=[redacted]");
  });

  it("formats cents without timers or inferred cost", () => {
    expect(formatCents(125)).toBe("$1.25");
    expect(formatCents(0)).toBe("$0.00");
  });
});
