import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = Buffer.from("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl", "base64").toString("utf8");
const SCOPE = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const DEFAULT_CALLBACK_HOST = "127.0.0.1";
const DEFAULT_CALLBACK_PORT = 53692;
const DEFAULT_REDIRECT_URI = "http://localhost:53692/callback";
// An abandoned login (operator never completes the browser consent, or the
// polling client itself gives up) must not squat the fixed callback port
// forever — that would silently block every later login attempt until the
// process restarts. Mirrors the same discovery made for CodexOAuthClient.
const DEFAULT_PENDING_LOGIN_TIMEOUT_MS = 600_000;

export interface ClaudeOAuthCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

export interface ClaudeOAuthClientOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly callbackHost?: string;
  readonly callbackPort?: number;
  readonly redirectUri?: string;
  readonly pendingLoginTimeoutMs?: number;
}

export interface ClaudeManagedLogin {
  readonly providerId: "anthropic-claude";
  readonly loginId: string;
  readonly authUrl: string;
}

export type ClaudeLoginStatus =
  | { readonly loginId: string; readonly state: "pending" }
  | { readonly loginId: string; readonly state: "succeeded" }
  | { readonly loginId: string; readonly state: "failed"; readonly message: string }
  | { readonly loginId: string; readonly state: "cancelled" };

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = randomBytes(32);
  const verifier = base64UrlEncode(verifierBytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

interface PendingLogin {
  state: "pending" | "succeeded" | "failed" | "cancelled";
  message?: string;
  credentials?: ClaudeOAuthCredentials;
  server?: Server;
  cancelled?: boolean;
  timeout?: ReturnType<typeof setTimeout>;
}

/**
 * Drives the Anthropic (Claude Pro/Max) OAuth PKCE flow directly (same public
 * client id and endpoints the Claude Code CLI itself uses), with no external
 * dependency. Structurally compatible with `CodexOAuthClient`'s login surface
 * so it can be wired into gateway composition the same way, plus
 * `getCredentials()` for retrieving the real token pair to persist.
 *
 * Anthropic's OAuth flow reuses the PKCE code verifier as the `state`
 * parameter (there is no separate state value), so `state` and `verifier`
 * are the same string throughout this client.
 */
export class ClaudeOAuthClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly callbackHost: string;
  private readonly callbackPort: number;
  private readonly redirectUri: string;
  private readonly pendingLoginTimeoutMs: number;
  private readonly logins = new Map<string, PendingLogin>();

  constructor(options: ClaudeOAuthClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.callbackHost = options.callbackHost ?? DEFAULT_CALLBACK_HOST;
    this.callbackPort = options.callbackPort ?? DEFAULT_CALLBACK_PORT;
    this.redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI;
    this.pendingLoginTimeoutMs = options.pendingLoginTimeoutMs ?? DEFAULT_PENDING_LOGIN_TIMEOUT_MS;
  }

  async startClaudeLogin(): Promise<ClaudeManagedLogin> {
    const { verifier, challenge } = await generatePkce();
    // Anthropic's flow reuses the PKCE verifier as the state parameter.
    const state = verifier;
    const loginId = state;
    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", this.redirectUri);
    authorizeUrl.searchParams.set("scope", SCOPE);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);

    const pending: PendingLogin = { state: "pending" };
    this.logins.set(loginId, pending);
    // Wait for the local callback server to actually bind before handing back
    // the authUrl: an unbound/EADDRINUSE server would otherwise hand out a
    // URL that can never complete, discovered only much later on first poll.
    await this.beginCallbackWait(loginId, state, verifier, pending);
    return { providerId: "anthropic-claude", loginId, authUrl: authorizeUrl.toString() };
  }

  private beginCallbackWait(loginId: string, expectedState: string, verifier: string, pending: PendingLogin): Promise<void> {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "", "http://localhost");
        if (url.pathname !== "/callback") {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (returnedState !== expectedState || code === null || code === "") {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("invalid callback");
          if (returnedState === expectedState)
            this.finishLogin(loginId, pending, { kind: "failed", message: "missing authorization code" });
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>Maestro Claude login complete. You can close this window.</body></html>");
        void this.exchangeAndFinish(loginId, pending, code, expectedState, verifier);
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("internal error");
        this.finishLogin(loginId, pending, {
          kind: "failed",
          message: error instanceof Error ? error.message : "callback handling failed",
        });
      }
    });
    pending.server = server;
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.finishLogin(loginId, pending, { kind: "failed", message: `local OAuth callback server failed: ${error.message}` });
        reject(new Error(`could not start the local OAuth callback server on ${this.callbackHost}:${this.callbackPort}: ${error.message}`));
      };
      server.once("error", onError);
      server.listen(this.callbackPort, this.callbackHost, () => {
        server.removeListener("error", onError);
        // Steady-state errors (e.g. after a client disconnects mid-request)
        // must still fail the login, just no longer reject this promise.
        server.on("error", (error) => {
          this.finishLogin(loginId, pending, { kind: "failed", message: `local OAuth callback server failed: ${error.message}` });
        });
        pending.timeout = setTimeout(() => {
          this.finishLogin(loginId, pending, { kind: "failed", message: "Claude login was not completed in time" });
        }, this.pendingLoginTimeoutMs);
        resolve();
      });
    });
  }

  private async exchangeAndFinish(loginId: string, pending: PendingLogin, code: string, state: string, verifier: string): Promise<void> {
    try {
      const response = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code,
          state,
          redirect_uri: this.redirectUri,
          code_verifier: verifier,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.finishLogin(loginId, pending, {
          kind: "failed",
          message: `token exchange failed (${response.status}): ${text || response.statusText}`,
        });
        return;
      }
      const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || typeof json.expires_in !== "number") {
        this.finishLogin(loginId, pending, { kind: "failed", message: "token exchange response is missing required fields" });
        return;
      }
      this.finishLogin(loginId, pending, {
        kind: "succeeded",
        credentials: { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000 },
      });
    } catch (error) {
      this.finishLogin(loginId, pending, { kind: "failed", message: error instanceof Error ? error.message : "token exchange failed" });
    }
  }

  private finishLogin(
    loginId: string,
    pending: PendingLogin,
    outcome: { kind: "succeeded"; credentials: ClaudeOAuthCredentials } | { kind: "failed"; message: string },
  ): void {
    if (pending.cancelled || pending.state !== "pending") return;
    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    pending.server?.close();
    if (outcome.kind === "succeeded") {
      pending.state = "succeeded";
      pending.credentials = outcome.credentials;
    } else {
      pending.state = "failed";
      pending.message = outcome.message;
    }
    this.logins.set(loginId, pending);
  }

  async getLoginStatus(loginId: string): Promise<ClaudeLoginStatus> {
    const pending = this.logins.get(loginId);
    if (pending === undefined)
      throw Object.assign(new Error("account login session is unknown"), { code: "account_login_session_unknown" });
    if (pending.state === "pending") return { loginId, state: "pending" };
    if (pending.state === "succeeded") return { loginId, state: "succeeded" };
    if (pending.state === "cancelled") return { loginId, state: "cancelled" };
    return { loginId, state: "failed", message: pending.message ?? "login failed" };
  }

  async cancelLogin(loginId: string): Promise<void> {
    const pending = this.logins.get(loginId);
    if (pending === undefined)
      throw Object.assign(new Error("account login session is unknown"), { code: "account_login_session_unknown" });
    pending.cancelled = true;
    pending.state = "cancelled";
    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    pending.server?.close();
  }

  /** Retrieves the real token pair for a succeeded login, so the caller can persist it. Not part of `CodexOAuthClient`'s narrower surface. */
  getCredentials(loginId: string): ClaudeOAuthCredentials | undefined {
    return this.logins.get(loginId)?.credentials;
  }

  async refresh(refreshToken: string): Promise<ClaudeOAuthCredentials> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Claude token refresh failed (${response.status}): ${text || response.statusText}`);
    }
    const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (typeof json.access_token !== "string" || typeof json.expires_in !== "number")
      throw new Error("Claude token refresh response is missing required fields");
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
  }

  /** Nothing to revoke server-side: Anthropic does not document a Claude token-revocation endpoint. Clearing the persisted secret is the caller's (gateway credential store's) job. Present so this class satisfies the same optional `logout` shape as `CodexOAuthClient`. */
  async logout(): Promise<void> {}

  async close(): Promise<void> {
    for (const pending of this.logins.values()) {
      if (pending.timeout !== undefined) clearTimeout(pending.timeout);
      pending.server?.close();
    }
  }
}
