import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { CodexLoginStatus, CodexManagedLogin } from "./codex-app-server.js";

const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const DEFAULT_CALLBACK_HOST = "127.0.0.1";
const DEFAULT_CALLBACK_PORT = 1455;
const DEFAULT_REDIRECT_URI = "http://localhost:1455/auth/callback";
// An abandoned login (operator never completes the browser consent, or the
// polling client itself gives up) must not squat the fixed callback port
// forever — that would silently block every later login attempt until the
// process restarts. This was discovered live: a client-side poll timeout
// left the server-side callback listener bound indefinitely.
const DEFAULT_PENDING_LOGIN_TIMEOUT_MS = 600_000;

export interface CodexOAuthCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId: string;
}

export interface CodexOAuthClientOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly callbackHost?: string;
  readonly callbackPort?: number;
  readonly redirectUri?: string;
  readonly pendingLoginTimeoutMs?: number;
}

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

function decodeJwtAccountId(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = payload[JWT_CLAIM_PATH];
    const accountId = auth && typeof auth === "object" ? (auth as Record<string, unknown>).chatgpt_account_id : undefined;
    return typeof accountId === "string" && accountId !== "" ? accountId : undefined;
  } catch {
    return undefined;
  }
}

interface PendingLogin {
  state: "pending" | "succeeded" | "failed" | "cancelled";
  message?: string;
  credentials?: CodexOAuthCredentials;
  server?: Server;
  cancelled?: boolean;
  timeout?: ReturnType<typeof setTimeout>;
}

/**
 * Drives the ChatGPT Codex OAuth PKCE flow directly (same public client id and
 * endpoints the `codex` CLI itself uses), with no dependency on an externally
 * installed `codex` executable. Structurally compatible with `CodexAppServerClient`'s
 * login surface so it can be swapped into `GatewayOptions.codex` unchanged, plus
 * `getCredentials()` for retrieving the real token pair to persist.
 */
export class CodexOAuthClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly callbackHost: string;
  private readonly callbackPort: number;
  private readonly redirectUri: string;
  private readonly pendingLoginTimeoutMs: number;
  private readonly logins = new Map<string, PendingLogin>();

  constructor(options: CodexOAuthClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.callbackHost = options.callbackHost ?? DEFAULT_CALLBACK_HOST;
    this.callbackPort = options.callbackPort ?? DEFAULT_CALLBACK_PORT;
    this.redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI;
    this.pendingLoginTimeoutMs = options.pendingLoginTimeoutMs ?? DEFAULT_PENDING_LOGIN_TIMEOUT_MS;
  }

  async startChatGptLogin(): Promise<CodexManagedLogin> {
    const { verifier, challenge } = await generatePkce();
    const state = randomBytes(16).toString("hex");
    const loginId = state;
    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", this.redirectUri);
    authorizeUrl.searchParams.set("scope", "openid profile email offline_access");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("id_token_add_organizations", "true");
    authorizeUrl.searchParams.set("originator", "maestro");

    const pending: PendingLogin = { state: "pending" };
    this.logins.set(loginId, pending);
    // Wait for the local callback server to actually bind before handing back
    // the authUrl: an unbound/EADDRINUSE server would otherwise hand out a
    // URL that can never complete, discovered only much later on first poll.
    await this.beginCallbackWait(loginId, state, verifier, pending);
    return { providerId: "openai-codex", loginId, authUrl: authorizeUrl.toString() };
  }

  private beginCallbackWait(loginId: string, expectedState: string, verifier: string, pending: PendingLogin): Promise<void> {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "", "http://localhost");
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (returnedState !== expectedState || code === null || code === "") {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("invalid callback");
          if (returnedState === expectedState) this.finishLogin(loginId, pending, { kind: "failed", message: "missing authorization code" });
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>Maestro ChatGPT login complete. You can close this window.</body></html>");
        void this.exchangeAndFinish(loginId, pending, code, verifier);
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("internal error");
        this.finishLogin(loginId, pending, { kind: "failed", message: error instanceof Error ? error.message : "callback handling failed" });
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
          this.finishLogin(loginId, pending, { kind: "failed", message: "ChatGPT login was not completed in time" });
        }, this.pendingLoginTimeoutMs);
        resolve();
      });
    });
  }

  private async exchangeAndFinish(loginId: string, pending: PendingLogin, code: string, verifier: string): Promise<void> {
    try {
      const response = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code,
          code_verifier: verifier,
          redirect_uri: this.redirectUri,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.finishLogin(loginId, pending, { kind: "failed", message: `token exchange failed (${response.status}): ${text || response.statusText}` });
        return;
      }
      const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (typeof json.access_token !== "string" || typeof json.refresh_token !== "string" || typeof json.expires_in !== "number") {
        this.finishLogin(loginId, pending, { kind: "failed", message: "token exchange response is missing required fields" });
        return;
      }
      const accountId = decodeJwtAccountId(json.access_token);
      if (accountId === undefined) {
        this.finishLogin(loginId, pending, { kind: "failed", message: "could not extract ChatGPT account id from access token" });
        return;
      }
      this.finishLogin(loginId, pending, {
        kind: "succeeded",
        credentials: { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000, accountId },
      });
    } catch (error) {
      this.finishLogin(loginId, pending, { kind: "failed", message: error instanceof Error ? error.message : "token exchange failed" });
    }
  }

  private finishLogin(loginId: string, pending: PendingLogin, outcome: { kind: "succeeded"; credentials: CodexOAuthCredentials } | { kind: "failed"; message: string }): void {
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

  async loginStatus(loginId: string): Promise<CodexLoginStatus> {
    const pending = this.logins.get(loginId);
    if (pending === undefined) throw Object.assign(new Error("account login session is unknown"), { code: "account_login_session_unknown" });
    if (pending.state === "pending") return { loginId, state: "pending" };
    if (pending.state === "succeeded") return { loginId, state: "succeeded" };
    if (pending.state === "cancelled") return { loginId, state: "cancelled" };
    return { loginId, state: "failed", message: pending.message ?? "login failed" };
  }

  async cancelLogin(loginId: string): Promise<void> {
    const pending = this.logins.get(loginId);
    if (pending === undefined) throw Object.assign(new Error("account login session is unknown"), { code: "account_login_session_unknown" });
    pending.cancelled = true;
    pending.state = "cancelled";
    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    pending.server?.close();
  }

  /** Retrieves the real token pair for a succeeded login, so the caller can persist it. Not part of `CodexAppServerClient`'s narrower surface. */
  getCredentials(loginId: string): CodexOAuthCredentials | undefined {
    return this.logins.get(loginId)?.credentials;
  }

  async refresh(refreshToken: string): Promise<CodexOAuthCredentials> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLIENT_ID }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Codex token refresh failed (${response.status}): ${text || response.statusText}`);
    }
    const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (typeof json.access_token !== "string" || typeof json.expires_in !== "number") throw new Error("Codex token refresh response is missing required fields");
    const accountId = decodeJwtAccountId(json.access_token);
    if (accountId === undefined) throw new Error("could not extract ChatGPT account id from refreshed access token");
    return { accessToken: json.access_token, refreshToken: json.refresh_token ?? refreshToken, expiresAt: Date.now() + json.expires_in * 1000, accountId };
  }

  /** Nothing to revoke server-side: OpenAI does not document a Codex token-revocation endpoint. Clearing the persisted secret is the caller's (gateway credential store's) job. Present so this class satisfies `GatewayOptions.codex`'s optional `logout` alongside `CodexAppServerClient`. */
  async logout(): Promise<void> {}

  async close(): Promise<void> {
    for (const pending of this.logins.values()) {
      if (pending.timeout !== undefined) clearTimeout(pending.timeout);
      pending.server?.close();
    }
  }
}
