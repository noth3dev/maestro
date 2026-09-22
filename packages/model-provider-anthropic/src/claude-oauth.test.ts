import { describe, expect, it, vi } from "vitest";
import { ClaudeOAuthClient } from "./claude-oauth.js";

// A dedicated, non-default test port: this suite must never bind the real
// 53692 default, which a genuinely running Maestro process could hold live.
const TEST_PORT = 28450;

async function completeCallback(code: string, state: string, port = TEST_PORT): Promise<Response> {
  const callback = new URL(`http://127.0.0.1:${port}/callback`);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return fetch(callback.toString());
}

describe("ClaudeOAuthClient", () => {
  it("builds a real Claude authorize URL with PKCE and state, and exposes it as loginId", async () => {
    const client = new ClaudeOAuthClient({ fetch: vi.fn(), callbackPort: TEST_PORT });
    try {
      const login = await client.startClaudeLogin();
      expect(login.providerId).toBe("anthropic-claude");
      const url = new URL(login.authUrl);
      expect(url.hostname).toBe("claude.ai");
      expect(url.pathname).toBe("/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toBeTruthy();
      expect(url.searchParams.get("state")).toBe(login.loginId);
      expect(url.searchParams.get("scope")).toBe(
        "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
      );
      expect(await client.getLoginStatus(login.loginId)).toEqual({ loginId: login.loginId, state: "pending" });
    } finally {
      await client.close();
    }
  });

  it("completes the real local callback server and exchanges the code for real tokens via fetch", async () => {
    const tokenFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://platform.claude.com/v1/oauth/token");
      const body = JSON.parse(init!.body as string);
      expect(body.grant_type).toBe("authorization_code");
      expect(body.client_id).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
      return new Response(JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }), { status: 200 });
    });
    const client = new ClaudeOAuthClient({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: TEST_PORT });
    try {
      const login = await client.startClaudeLogin();
      const state = new URL(login.authUrl).searchParams.get("state")!;
      const response = await completeCallback("auth-code-1", state);
      expect(response.status).toBe(200);

      let status = await client.getLoginStatus(login.loginId);
      for (let attempt = 0; attempt < 20 && status.state === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        status = await client.getLoginStatus(login.loginId);
      }
      expect(status).toEqual({ loginId: login.loginId, state: "succeeded" });
      expect(client.getCredentials(login.loginId)).toEqual({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: expect.any(Number),
      });
      expect(tokenFetch).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });

  it("rejects a callback with the wrong state and leaves the login pending", async () => {
    const client = new ClaudeOAuthClient({ fetch: vi.fn(), callbackPort: TEST_PORT });
    try {
      const login = await client.startClaudeLogin();
      const response = await completeCallback("auth-code-1", "wrong-state");
      expect(response.status).toBe(400);
      expect(await client.getLoginStatus(login.loginId)).toEqual({ loginId: login.loginId, state: "pending" });
    } finally {
      await client.close();
    }
  });

  it("reports failed status when the token exchange fails, without throwing from the callback", async () => {
    const tokenFetch = vi.fn(async () => new Response("bad request", { status: 400, statusText: "Bad Request" }));
    const client = new ClaudeOAuthClient({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: TEST_PORT });
    try {
      const login = await client.startClaudeLogin();
      const state = new URL(login.authUrl).searchParams.get("state")!;
      await completeCallback("auth-code-1", state);

      let status = await client.getLoginStatus(login.loginId);
      for (let attempt = 0; attempt < 20 && status.state === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        status = await client.getLoginStatus(login.loginId);
      }
      expect(status.state).toBe("failed");
      expect(client.getCredentials(login.loginId)).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it("throws for an unknown login id", async () => {
    const client = new ClaudeOAuthClient({ fetch: vi.fn(), callbackPort: TEST_PORT });
    try {
      await expect(client.getLoginStatus("unknown-login-id")).rejects.toMatchObject({ message: "account login session is unknown" });
      await expect(client.cancelLogin("unknown-login-id")).rejects.toMatchObject({ message: "account login session is unknown" });
    } finally {
      await client.close();
    }
  });

  it("cancels a pending login and ignores a callback that arrives afterward", async () => {
    const tokenFetch = vi.fn();
    const client = new ClaudeOAuthClient({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: TEST_PORT });
    try {
      const login = await client.startClaudeLogin();
      const state = new URL(login.authUrl).searchParams.get("state")!;
      await client.cancelLogin(login.loginId);
      expect(await client.getLoginStatus(login.loginId)).toEqual({ loginId: login.loginId, state: "cancelled" });
      await expect(completeCallback("auth-code-1", state)).rejects.toBeDefined();
      expect(tokenFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("rejects startClaudeLogin instead of returning a doomed authUrl when the callback port is already bound", async () => {
    const port = 28455;
    const first = new ClaudeOAuthClient({ fetch: vi.fn(), callbackPort: port });
    const second = new ClaudeOAuthClient({ fetch: vi.fn(), callbackPort: port });
    try {
      await first.startClaudeLogin();
      await expect(second.startClaudeLogin()).rejects.toThrow(/could not start the local OAuth callback server/);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("auto-times-out an abandoned pending login and frees its callback port instead of squatting it forever", async () => {
    const port = 28456;
    const abandoned = new ClaudeOAuthClient({ fetch: vi.fn(), callbackPort: port, pendingLoginTimeoutMs: 50 });
    try {
      const login = await abandoned.startClaudeLogin();
      // Nobody ever completes the callback.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await abandoned.getLoginStatus(login.loginId)).toMatchObject({
        state: "failed",
        message: expect.stringContaining("not completed in time"),
      });

      // The port must be free now: a second, unrelated client can bind it.
      const next = new ClaudeOAuthClient({ fetch: vi.fn(), callbackPort: port });
      try {
        await expect(next.startClaudeLogin()).resolves.toMatchObject({ providerId: "anthropic-claude" });
      } finally {
        await next.close();
      }
    } finally {
      await abandoned.close();
    }
  });

  it("rejects a second concurrent login attempt while the port is already occupied by a pending login on the same client", async () => {
    const port = 28457;
    const client = new ClaudeOAuthClient({ fetch: vi.fn(), callbackPort: port });
    try {
      await client.startClaudeLogin();
      await expect(client.startClaudeLogin()).rejects.toThrow(/could not start the local OAuth callback server/);
    } finally {
      await client.close();
    }
  });

  it("refreshes an access token via a real token-endpoint fetch call", async () => {
    const refreshFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://platform.claude.com/v1/oauth/token");
      const body = JSON.parse(init!.body as string);
      expect(body.grant_type).toBe("refresh_token");
      expect(body.refresh_token).toBe("old-refresh");
      expect(body.client_id).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
      return new Response(JSON.stringify({ access_token: "access-2", refresh_token: "new-refresh", expires_in: 1800 }), { status: 200 });
    });
    const client = new ClaudeOAuthClient({ fetch: refreshFetch as unknown as typeof fetch });
    try {
      const credentials = await client.refresh("old-refresh");
      expect(credentials).toEqual({ accessToken: "access-2", refreshToken: "new-refresh", expiresAt: expect.any(Number) });
    } finally {
      await client.close();
    }
  });

  it("reports a failure when the token refresh request fails", async () => {
    const refreshFetch = vi.fn(async () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" }));
    const client = new ClaudeOAuthClient({ fetch: refreshFetch as unknown as typeof fetch });
    try {
      await expect(client.refresh("old-refresh")).rejects.toThrow(/Claude token refresh failed/);
    } finally {
      await client.close();
    }
  });
});
