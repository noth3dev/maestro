import { describe, expect, it, vi } from "vitest";
import { buildServer, type GoalService } from "./server.js";
import type { OperatorAuthenticator, SettingsService } from "./server-ports.js";
import type { SettingsRead } from "@maestro/contracts";

const operator = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };
const goalService = { createGoal: vi.fn(), transitionGoal: vi.fn(), pauseGoal: vi.fn(), stopGoal: vi.fn(), resumeGoal: vi.fn(), emergencyStopGoal: vi.fn(), getGoal: vi.fn() } as unknown as GoalService;
const authenticator: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "authenticated", operator }) };
const settings: SettingsRead = { preferences: { compactSidebar: false, desktopPush: true, emailDigest: false, slackWebhook: false }, authorityDefaults: { spendCeilingCents: 5000, criticalActionsRequireApproval: true, allowFlashmob: true }, models: [{ modelRef: "openai/gpt-5.6-sol", score: 145, inUse: true }, { modelRef: "anthropic/claude-sonnet-5", score: null, inUse: false }], providers: [{ providerId: "openai", connected: true, authModes: ["api-key"] }] };

describe("authenticated settings routes", () => {
  it("reads durable provider/model/authority settings and applies human updates", async () => {
    const service: SettingsService = { get: vi.fn(async () => settings), updatePreferences: vi.fn(async () => settings), updateModelPool: vi.fn(async () => settings), updateAuthorityDefaults: vi.fn(async () => settings) };
    const app = buildServer({ goalService, authenticator, settingsService: service });
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const read = await app.inject({ method: "GET", url: "/v1/settings", headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(settings);
    const defaults = await app.inject({ method: "PATCH", url: "/v1/settings/authority-defaults", headers, payload: { spendCeilingCents: 9000, criticalActionsRequireApproval: false, allowFlashmob: false } });
    expect(defaults.statusCode).toBe(200);
    expect(service.updateAuthorityDefaults).toHaveBeenCalledWith(operator.operatorId, { spendCeilingCents: 9000, criticalActionsRequireApproval: false, allowFlashmob: false });
    const pool = await app.inject({ method: "PATCH", url: "/v1/settings/model-pool", headers, payload: { modelRef: "anthropic/claude-sonnet-5", inUse: true } });
    expect(pool.statusCode).toBe(200);
    expect(service.updateModelPool).toHaveBeenCalledWith(operator.operatorId, { modelRef: "anthropic/claude-sonnet-5", inUse: true });
    await app.close();
  });


  it("reports provider connection status without exposing credentials", async () => {
    const list = vi.fn(async () => [{ providerId: "openai", connected: true, authModes: ["api-key"] as const }]);
    const providerCredentials = { bind: vi.fn(), revoke: vi.fn(), list };
    const app = buildServer({ goalService, authenticator, providerCredentials });
    const response = await app.inject({ method: "GET", url: "/v1/provider-credentials", headers: { authorization: "Bearer test-secret" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ providerId: "openai", connected: true, authModes: ["api-key"] }]);
    expect(response.body).not.toContain("secret");
    await app.close();
  });

  it("rejects malformed settings updates before durable service calls", async () => {
    const service: SettingsService = { get: vi.fn(async () => settings), updatePreferences: vi.fn(async () => settings), updateModelPool: vi.fn(async () => settings), updateAuthorityDefaults: vi.fn(async () => settings) };
    const app = buildServer({ goalService, authenticator, settingsService: service });
    const response = await app.inject({ method: "PATCH", url: "/v1/settings/preferences", headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, payload: { desktopPush: "yes" } });
    expect(response.statusCode).toBe(400);
    expect(service.updatePreferences).not.toHaveBeenCalled();
    await app.close();
  });
});
