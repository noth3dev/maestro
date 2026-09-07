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
