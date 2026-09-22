import { describe, expect, it, vi } from "vitest";
import { createClaudeAccessTokenResolver } from "./claude-token-resolver.js";

describe("createClaudeAccessTokenResolver", () => {
  it("returns the stored access token unchanged when it is not near expiry", async () => {
    const stored = { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 3_600_000 };
    const credentials = { resolveForGateway: vi.fn(async () => JSON.stringify(stored)), bind: vi.fn() };
    const refresh = vi.fn();
    const resolve = createClaudeAccessTokenResolver({ credentials, operatorId: "op-1", refresh });

    const result = await resolve("account-ref-1");

    expect(result).toEqual({ accessToken: "access-1", accountId: undefined });
    expect(refresh).not.toHaveBeenCalled();
    expect(credentials.bind).not.toHaveBeenCalled();
  });

  it("refreshes and re-persists the token pair when it is at or past expiry", async () => {
    const now = Date.now();
    const stored = { accessToken: "stale-access", refreshToken: "refresh-1", expiresAt: now - 1 };
    const refreshed = { accessToken: "fresh-access", refreshToken: "fresh-refresh", expiresAt: now + 3_600_000 };
    const credentials = { resolveForGateway: vi.fn(async () => JSON.stringify(stored)), bind: vi.fn(async () => ({})) };
    const refresh = vi.fn(async (refreshToken: string) => {
      expect(refreshToken).toBe("refresh-1");
      return refreshed;
    });
    const resolve = createClaudeAccessTokenResolver({ credentials, operatorId: "op-1", refresh, now: () => now });

    const result = await resolve("account-ref-1");

    expect(result).toEqual({ accessToken: "fresh-access", accountId: undefined });
    expect(credentials.bind).toHaveBeenCalledWith(
      { operatorId: "op-1", providerId: "anthropic-claude", authMode: "managed-subscription", accountRef: "account-ref-1" },
      JSON.stringify(refreshed),
    );
  });

  it("refreshes proactively inside the expiry buffer, not only after the token has already expired", async () => {
    const now = Date.now();
    const stored = { accessToken: "stale-access", refreshToken: "refresh-1", expiresAt: now + 30_000 };
    const refreshed = { accessToken: "fresh-access", refreshToken: "fresh-refresh", expiresAt: now + 3_600_000 };
    const credentials = { resolveForGateway: vi.fn(async () => JSON.stringify(stored)), bind: vi.fn(async () => ({})) };
    const refresh = vi.fn(async () => refreshed);
    const resolve = createClaudeAccessTokenResolver({ credentials, operatorId: "op-1", refresh, now: () => now });

    const result = await resolve("account-ref-1");

    expect(refresh).toHaveBeenCalledOnce();
    expect(result).toEqual({ accessToken: "fresh-access", accountId: undefined });
  });

  it("shares one in-flight refresh across concurrent calls near expiry instead of spending the rotating refresh token twice", async () => {
    const now = Date.now();
    const stored = { accessToken: "stale-access", refreshToken: "refresh-1", expiresAt: now - 1 };
    const refreshed = { accessToken: "fresh-access", refreshToken: "fresh-refresh", expiresAt: now + 3_600_000 };
    const credentials = { resolveForGateway: vi.fn(async () => JSON.stringify(stored)), bind: vi.fn(async () => ({})) };
    let refreshCalls = 0;
    const refresh = vi.fn(async () => {
      refreshCalls += 1;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      return refreshed;
    });
    const resolve = createClaudeAccessTokenResolver({ credentials, operatorId: "op-1", refresh, now: () => now });

    const [first, second] = await Promise.all([resolve("account-ref-1"), resolve("account-ref-1")]);

    expect(refreshCalls).toBe(1);
    expect(first).toEqual({ accessToken: "fresh-access", accountId: undefined });
    expect(second).toEqual({ accessToken: "fresh-access", accountId: undefined });
    expect(credentials.bind).toHaveBeenCalledOnce();
  });

  it("rejects a malformed stored credential instead of silently returning garbage", async () => {
    const credentials = { resolveForGateway: vi.fn(async () => "not json"), bind: vi.fn() };
    const resolve = createClaudeAccessTokenResolver({ credentials, operatorId: "op-1", refresh: vi.fn() });

    await expect(resolve("account-ref-1")).rejects.toThrow("stored Claude credential is malformed");
  });

  it("rejects a stored credential missing required fields", async () => {
    const credentials = { resolveForGateway: vi.fn(async () => JSON.stringify({ accessToken: "a" })), bind: vi.fn() };
    const resolve = createClaudeAccessTokenResolver({ credentials, operatorId: "op-1", refresh: vi.fn() });

    await expect(resolve("account-ref-1")).rejects.toThrow("stored Claude credential is missing required fields");
  });
});
