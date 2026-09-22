import { describe, expect, it, vi } from "vitest";
import { CodexOAuthClient } from "./codex-oauth.js";

// A dedicated, non-default test port: this suite must never bind the real
// 1455 default, which a genuinely running Maestro process could hold live.
const TEST_PORT = 18450;

function fakeAccessToken(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url");
  return `${header}.${payload}.sig`;
}

async function completeCallback(code: string, state: string, port = TEST_PORT): Promise<Response> {
  const callback = new URL(`http://127.0.0.1:${port}/auth/callback`);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return fetch(callback.toString());
}

describe("CodexOAuthClient", () => {
  it("builds a real ChatGPT authorize URL with PKCE and state, and exposes it as loginId", async () => {
    const client = new CodexOAuthClient({ fetch: vi.fn(), callbackPort: TEST_PORT });
    try {
      const login = await client.startChatGptLogin();
      expect(login.providerId).toBe("openai-codex");
      const url = new URL(login.authUrl);
      expect(url.hostname).toBe("auth.openai.com");
      expect(url.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toBeTruthy();
      expect(url.searchParams.get("state")).toBe(login.loginId);
      expect(await client.loginStatus(login.loginId)).toEqual({ loginId: login.loginId, state: "pending" });
    } finally {
      await client.close();
    }
  });

  it("completes the real local callback server and exchanges the code for real tokens via fetch", async () => {
    const accessToken = fakeAccessToken("acct-123");
    const tokenFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://auth.openai.com/oauth/token");
      return new Response(JSON.stringify({ access_token: accessToken, refresh_token: "refresh-1", expires_in: 3600 }), { status: 200 });
    });
    const client = new CodexOAuthClient({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: TEST_PORT });
    try {
      const login = await client.startChatGptLogin();
      const state = new URL(login.authUrl).searchParams.get("state")!;
      const response = await completeCallback("auth-code-1", state);
      expect(response.status).toBe(200);

      let status = await client.loginStatus(login.loginId);
      for (let attempt = 0; attempt < 20 && status.state === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        status = await client.loginStatus(login.loginId);
      }
      expect(status).toEqual({ loginId: login.loginId, state: "succeeded" });
      expect(client.getCredentials(login.loginId)).toEqual({ accessToken, refreshToken: "refresh-1", expiresAt: expect.any(Number), accountId: "acct-123" });
      expect(tokenFetch).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });

  it("rejects a callback with the wrong state and leaves the login pending", async () => {
    const client = new CodexOAuthClient({ fetch: vi.fn(), callbackPort: TEST_PORT });
    try {
      const login = await client.startChatGptLogin();
      const response = await completeCallback("auth-code-1", "wrong-state");
      expect(response.status).toBe(400);
      expect(await client.loginStatus(login.loginId)).toEqual({ loginId: login.loginId, state: "pending" });
    } finally {
      await client.close();
    }
  });

  it("reports failed status when the token exchange fails, without throwing from the callback", async () => {
    const tokenFetch = vi.fn(async () => new Response("bad request", { status: 400, statusText: "Bad Request" }));
    const client = new CodexOAuthClient({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: TEST_PORT });
    try {
      const login = await client.startChatGptLogin();
      const state = new URL(login.authUrl).searchParams.get("state")!;
      await completeCallback("auth-code-1", state);

      let status = await client.loginStatus(login.loginId);
      for (let attempt = 0; attempt < 20 && status.state === "pending"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        status = await client.loginStatus(login.loginId);
      }
      expect(status.state).toBe("failed");
      expect(client.getCredentials(login.loginId)).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it("throws for an unknown login id", async () => {
    const client = new CodexOAuthClient({ fetch: vi.fn(), callbackPort: TEST_PORT });
    try {
      await expect(client.loginStatus("unknown-login-id")).rejects.toMatchObject({ message: "account login session is unknown" });
      await expect(client.cancelLogin("unknown-login-id")).rejects.toMatchObject({ message: "account login session is unknown" });
    } finally {
      await client.close();
    }
  });

  it("cancels a pending login and ignores a callback that arrives afterward", async () => {
    const tokenFetch = vi.fn();
    const client = new CodexOAuthClient({ fetch: tokenFetch as unknown as typeof fetch, callbackPort: TEST_PORT });
    try {
      const login = await client.startChatGptLogin();
      const state = new URL(login.authUrl).searchParams.get("state")!;
      await client.cancelLogin(login.loginId);
      expect(await client.loginStatus(login.loginId)).toEqual({ loginId: login.loginId, state: "cancelled" });
      await expect(completeCallback("auth-code-1", state)).rejects.toBeDefined();
      expect(tokenFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("rejects startChatGptLogin instead of returning a doomed authUrl when the callback port is already bound", async () => {
    const port = 18455;
    const first = new CodexOAuthClient({ fetch: vi.fn(), callbackPort: port });
    const second = new CodexOAuthClient({ fetch: vi.fn(), callbackPort: port });
    try {
      await first.startChatGptLogin();
      await expect(second.startChatGptLogin()).rejects.toThrow(/could not start the local OAuth callback server/);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("auto-times-out an abandoned pending login and frees its callback port instead of squatting it forever", async () => {
    const port = 18456;
    const abandoned = new CodexOAuthClient({ fetch: vi.fn(), callbackPort: port, pendingLoginTimeoutMs: 50 });
    try {
      const login = await abandoned.startChatGptLogin();
      // Nobody ever completes the callback.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await abandoned.loginStatus(login.loginId)).toMatchObject({ state: "failed", message: expect.stringContaining("not completed in time") });

      // The port must be free now: a second, unrelated client can bind it.
      const next = new CodexOAuthClient({ fetch: vi.fn(), callbackPort: port });
      try {
        await expect(next.startChatGptLogin()).resolves.toMatchObject({ providerId: "openai-codex" });
      } finally {
        await next.close();
      }
    } finally {
      await abandoned.close();
    }
  });

  it("refreshes an access token via a real token-endpoint fetch call", async () => {
    const accessToken = fakeAccessToken("acct-456");
    const refreshFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh");
      return new Response(JSON.stringify({ access_token: accessToken, refresh_token: "new-refresh", expires_in: 1800 }), { status: 200 });
    });
    const client = new CodexOAuthClient({ fetch: refreshFetch as unknown as typeof fetch });
    try {
      const credentials = await client.refresh("old-refresh");
      expect(credentials).toEqual({ accessToken, refreshToken: "new-refresh", expiresAt: expect.any(Number), accountId: "acct-456" });
    } finally {
      await client.close();
    }
  });
});
