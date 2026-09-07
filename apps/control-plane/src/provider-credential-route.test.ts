import { describe, expect, it, vi } from "vitest";
import { buildServer, type GoalService, type OperatorAuthenticator, type ProviderCredentialService } from "./server.js";
import { ModelGatewayClientError } from "./model-gateway-client.js";
import type { AccountLoginStore } from "@maestro/persistence";

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
    const starting = { loginId: "durable-login-1", requestId: "request-1", operatorId: operator.operatorId, ownerId: "control-plane-test", providerId: "openai-codex" as const, providerLoginId: null, authUrl: null, state: "starting" as const, message: null };
    const pending = { ...starting, providerLoginId: "login-1", authUrl: "https://chatgpt.com/login", state: "pending" as const };
    const accountLoginStore: AccountLoginStore = {
      reserveStart: vi.fn(async () => ({ created: true, record: starting })), completeStart: vi.fn(async () => pending), failStart: vi.fn(async () => starting),
      get: vi.fn(async () => pending), getByRequest: vi.fn(async () => pending), updateState: vi.fn(async () => pending),
      claimOperation: vi.fn(async () => "operation-token"), releaseOperation: vi.fn(async () => {}), recoverStarting: vi.fn(async () => 0),
    };
    const service: ProviderCredentialService = { bind: vi.fn(), revoke: vi.fn(), startAccountLogin, accountLoginStatus, cancelAccountLogin: vi.fn() };
    const app = buildServer({ goalService, authenticator, providerCredentials: service, accountLoginStore });
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const start = await app.inject({ method: "POST", url: "/v1/provider-account-logins/start", headers, payload: { providerId: "openai-codex" } });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toEqual({ providerId: "openai-codex", loginId: "durable-login-1", authUrl: "https://chatgpt.com/login" });
    expect(startAccountLogin).toHaveBeenCalledWith({ operatorId: operator.operatorId, requestId: expect.any(String), providerId: "openai-codex" });
    const status = await app.inject({ method: "POST", url: "/v1/provider-account-logins/status", headers, payload: { providerId: "openai-codex", loginId: "login-1" } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ providerId: "openai-codex", loginId: "durable-login-1", state: "pending" });
    await app.close();
  });


  it("uses the durable request record so a repeated idempotency key starts only one browser login", async () => {
    const startAccountLogin = vi.fn(async () => ({ providerId: "openai-codex" as const, loginId: "provider-login-1", authUrl: "https://chatgpt.com/login" }));
    const record = { loginId: "durable-login-1", requestId: "request-1", operatorId: operator.operatorId, ownerId: "control-plane-test", providerId: "openai-codex" as const, providerLoginId: "provider-login-1", authUrl: "https://chatgpt.com/login", state: "pending" as const, message: null };
    let first = true;
    const accountLoginStore: AccountLoginStore = {
      reserveStart: vi.fn(async () => ({ created: first, record: (first = false, record) })),
      completeStart: vi.fn(async () => record),
      failStart: vi.fn(async () => record),
      get: vi.fn(async () => record),
      getByRequest: vi.fn(async () => record),
      updateState: vi.fn(async () => record),
      claimOperation: vi.fn(async () => "operation-token"), releaseOperation: vi.fn(async () => {}), recoverStarting: vi.fn(async () => 0),
    };
    const service: ProviderCredentialService = { bind: vi.fn(), revoke: vi.fn(), startAccountLogin };
    const app = buildServer({ goalService, authenticator, providerCredentials: service, accountLoginStore });
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json", "idempotency-key": "request-1" };
    const firstResponse = await app.inject({ method: "POST", url: "/v1/provider-account-logins/start", headers, payload: { providerId: "openai-codex" } });
    const secondResponse = await app.inject({ method: "POST", url: "/v1/provider-account-logins/start", headers, payload: { providerId: "openai-codex" } });
    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json()).toEqual(firstResponse.json());
    expect(startAccountLogin).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("maps the durable login id to the provider session and records gateway restart as unknown", async () => {
    const accountLoginStatus = vi.fn(async (input: Parameters<NonNullable<ProviderCredentialService["accountLoginStatus"]>>[0]) => {
      if (input.loginId === "provider-login-1") return { providerId: "openai-codex" as const, loginId: input.loginId, state: "pending" as const };
      throw new ModelGatewayClientError("account_login_session_unknown", 409, "account login session is unknown");
    });
    const pending = { loginId: "durable-login-1", requestId: "request-1", operatorId: operator.operatorId, ownerId: "control-plane-test", providerId: "openai-codex" as const, providerLoginId: "provider-login-1", authUrl: "https://chatgpt.com/login", state: "pending" as const, message: null };
    const unknown = { ...pending, state: "unknown" as const, message: "Gateway login session was lost during restart" };
    const accountLoginStore: AccountLoginStore = {
      reserveStart: vi.fn(), completeStart: vi.fn(), failStart: vi.fn(),
      get: vi.fn(async () => pending), getByRequest: vi.fn(), updateState: vi.fn(async () => unknown), claimOperation: vi.fn(async () => "operation-token"), releaseOperation: vi.fn(async () => {}), recoverStarting: vi.fn(async () => 0),
    };
    const service: ProviderCredentialService = { bind: vi.fn(), revoke: vi.fn(), accountLoginStatus };
    const app = buildServer({ goalService, authenticator, providerCredentials: service, accountLoginStore });
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const first = await app.inject({ method: "POST", url: "/v1/provider-account-logins/status", headers, payload: { providerId: "openai-codex", loginId: "durable-login-1" } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ providerId: "openai-codex", loginId: "durable-login-1", state: "unknown", message: "Gateway login session was lost during restart" });
    expect(accountLoginStatus).toHaveBeenCalledWith({ operatorId: operator.operatorId, requestId: expect.any(String), providerId: "openai-codex", loginId: "provider-login-1" });
    await app.close();
  });

  it("serializes status and cancel so a concurrent operation gets a truthful conflict", async () => {
    const pending = { loginId: "durable-login-race", requestId: "request-race", operatorId: operator.operatorId, ownerId: "control-plane-test", providerId: "openai-codex" as const, providerLoginId: "provider-login-race", authUrl: "https://chatgpt.com/login", state: "pending" as const, message: null };
    let claims = 0;
    let signalClaimed!: () => void;
    const claimStarted = new Promise<void>((resolve) => { signalClaimed = resolve; });
    let releaseProvider!: () => void;
    const providerReleased = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const accountLoginStatus = vi.fn(async () => { await providerReleased; return { providerId: "openai-codex" as const, loginId: pending.providerLoginId!, state: "pending" as const }; });
    const cancelAccountLogin = vi.fn(async () => {});
    const accountLoginStore: AccountLoginStore = {
      reserveStart: vi.fn(), completeStart: vi.fn(), failStart: vi.fn(),
      get: vi.fn(async () => pending), getByRequest: vi.fn(), updateState: vi.fn(async () => pending),
      claimOperation: vi.fn(async () => { if (claims++ === 0) { signalClaimed(); return "operation-token"; } return undefined; }),
      releaseOperation: vi.fn(async () => {}), recoverStarting: vi.fn(async () => 0),
    };
    const service: ProviderCredentialService = { bind: vi.fn(), revoke: vi.fn(), accountLoginStatus, cancelAccountLogin };
    const app = buildServer({ goalService, authenticator, providerCredentials: service, accountLoginStore });
    const headers = { authorization: "Bearer test-secret", "content-type": "application/json" };
    const statusRequest = app.inject({ method: "POST", url: "/v1/provider-account-logins/status", headers, payload: { providerId: "openai-codex", loginId: pending.loginId } });
    await claimStarted;
    const cancelResponse = await app.inject({ method: "POST", url: "/v1/provider-account-logins/cancel", headers, payload: { providerId: "openai-codex", loginId: pending.loginId } });
    expect(cancelResponse.statusCode).toBe(409);
    expect(cancelAccountLogin).not.toHaveBeenCalled();
    releaseProvider();
    const statusResponse = await statusRequest;
    expect(statusResponse.statusCode).toBe(200);
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
