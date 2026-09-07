import { describe, expect, it, vi } from "vitest";
import { buildServer, type GoalService, type OperatorAuthenticator, type ProviderCredentialService } from "./server.js";

const operator = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };
const goalService = { createGoal: vi.fn(), transitionGoal: vi.fn(), pauseGoal: vi.fn(), stopGoal: vi.fn(), resumeGoal: vi.fn(), emergencyStopGoal: vi.fn(), getGoal: vi.fn() } as unknown as GoalService;
const authenticator: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "authenticated", operator }) };

describe("provider credential routes", () => {
  it("derives the operator from bearer authentication and never returns the secret", async () => {
    const bind = vi.fn(async (input: Parameters<ProviderCredentialService["bind"]>[0]) => ({ bindingId: "credential-1", providerId: input.providerId, authMode: "api-key" as const, accountRef: "openai-operator", configuredAt: "2025-01-01T00:00:00.000Z" }));
    const service: ProviderCredentialService = { bind, revoke: vi.fn(async () => {}) };
    const app = buildServer({ goalService, authenticator, providerCredentials: service });
    const response = await app.inject({ method: "POST", url: "/v1/provider-credentials", headers: { authorization: "Bearer test-secret", "content-type": "application/json", "idempotency-key": "request-1" }, payload: { providerId: "openai", authMode: "api-key", secret: "sk-live-example" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ bindingId: "credential-1", providerId: "openai", authMode: "api-key", accountRef: "openai-operator", configuredAt: "2025-01-01T00:00:00.000Z" });
    expect(response.body).not.toContain("sk-live-example");
    expect(bind).toHaveBeenCalledWith({ operatorId: operator.operatorId, requestId: "request-1", providerId: "openai", authMode: "api-key", secret: "sk-live-example" });
    await app.close();
  });

  it("rejects unsupported provider login input before calling the service", async () => {
    const service: ProviderCredentialService = { bind: vi.fn(), revoke: vi.fn() };
    const app = buildServer({ goalService, authenticator, providerCredentials: service });
    const response = await app.inject({ method: "POST", url: "/v1/provider-credentials", headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, payload: { providerId: "openai-codex", authMode: "managed-subscription", secret: "private-token" } });
    expect(response.statusCode).toBe(400);
    expect(service.bind).not.toHaveBeenCalled();
    expect(response.body).not.toContain("private-token");
    await app.close();
  });

  it("revokes only the authenticated operator's provider binding", async () => {
    const revoke = vi.fn(async () => {});
    const service: ProviderCredentialService = { bind: vi.fn(), revoke };
    const app = buildServer({ goalService, authenticator, providerCredentials: service });
    const response = await app.inject({ method: "DELETE", url: "/v1/provider-credentials/anthropic", headers: { authorization: "Bearer test-secret", "idempotency-key": "request-2" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revoked: true });
    expect(revoke).toHaveBeenCalledWith({ operatorId: operator.operatorId, requestId: "request-2", providerId: "anthropic" });
    await app.close();
  });
});


describe("provider account login routes", () => {
  it("returns only the approved OpenAI Codex browser login state", async () => {
    const startAccountLogin = vi.fn(async () => ({ providerId: "openai-codex" as const, loginId: "login-1", authUrl: "https://chatgpt.com/login" }));
    const accountLoginStatus = vi.fn(async () => ({ providerId: "openai-codex" as const, loginId: "login-1", state: "pending" as const }));
    const service: ProviderCredentialService = { bind: vi.fn(), revoke: vi.fn(), startAccountLogin, accountLoginStatus, cancelAccountLogin: vi.fn() };
    const app = buildServer({ goalService, authenticator, providerCredentials: service });
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const start = await app.inject({ method: "POST", url: "/v1/provider-account-logins/start", headers, payload: { providerId: "openai-codex" } });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toEqual({ providerId: "openai-codex", loginId: "login-1", authUrl: "https://chatgpt.com/login" });
    expect(startAccountLogin).toHaveBeenCalledWith({ operatorId: operator.operatorId, requestId: expect.any(String), providerId: "openai-codex" });
    const status = await app.inject({ method: "POST", url: "/v1/provider-account-logins/status", headers, payload: { providerId: "openai-codex", loginId: "login-1" } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ providerId: "openai-codex", loginId: "login-1", state: "pending" });
    await app.close();
  });

  it("supports explicit OpenAI account logout without accepting a secret", async () => {
    const logoutAccount = vi.fn(async () => {});
    const service: ProviderCredentialService = { bind: vi.fn(), revoke: vi.fn(), logoutAccount };
    const app = buildServer({ goalService, authenticator, providerCredentials: service });
    const response = await app.inject({ method: "POST", url: "/v1/provider-account-logins/logout", headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, payload: { providerId: "openai-codex" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revoked: true });
    expect(logoutAccount).toHaveBeenCalledWith({ operatorId: operator.operatorId, requestId: expect.any(String), providerId: "openai-codex" });
    await app.close();
  });

  it("does not offer an Anthropic subscription login", async () => {
    const service: ProviderCredentialService = { bind: vi.fn(), revoke: vi.fn(), startAccountLogin: vi.fn() };
    const app = buildServer({ goalService, authenticator, providerCredentials: service });
    const response = await app.inject({ method: "POST", url: "/v1/provider-account-logins/start", headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, payload: { providerId: "anthropic" } });
    expect(response.statusCode).toBe(400);
    expect(service.startAccountLogin).not.toHaveBeenCalled();
    await app.close();
  });
});
