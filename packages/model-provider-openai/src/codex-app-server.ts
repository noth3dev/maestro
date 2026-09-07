import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export interface CodexAppServerTransport {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  close(): Promise<void>;
}

export interface CodexAppServerOptions {
  readonly transport?: CodexAppServerTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly requestTimeoutMs?: number;
  readonly clientInfo?: { readonly name: string; readonly title: string; readonly version: string };
}

export interface CodexManagedLogin {
  readonly providerId: "openai-codex";
  readonly loginId: string;
  readonly authUrl: string;
}

export type CodexLoginStatus =
  | { readonly loginId: string; readonly state: "pending" }
  | { readonly loginId: string; readonly state: "succeeded" }
  | { readonly loginId: string; readonly state: "failed"; readonly message: string }
  | { readonly loginId: string; readonly state: "cancelled" };

export interface CodexAccountSummary {
  readonly authMode: "chatgpt" | "apikey" | "personalAccessToken" | "null" | "unknown";
  readonly email?: string;
  readonly planType?: string;
}

type JsonRpcResponse = { readonly id: number; readonly result?: unknown; readonly error?: { readonly message?: unknown } };
type JsonRpcNotification = { readonly method: string; readonly params?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Codex app-server response missing ${field}`);
  return value;
}

function validateAuthUrl(value: unknown): string {
  const authUrl = requiredString(value, "authUrl");
  let parsed: URL;
  try {
    parsed = new URL(authUrl);
  } catch {
    throw new Error("Codex app-server returned an invalid auth URL");
  }
  if (parsed.protocol !== "https:" || !["chatgpt.com", "auth.openai.com"].includes(parsed.hostname)) {
    throw new Error("Codex app-server returned an untrusted auth URL");
  }
  return authUrl;
}

function redactChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MAESTRO_API_TOKEN", "MAESTRO_MODEL_GATEWAY_TOKEN"]) delete childEnv[key];
  return childEnv;
}

class StdioTransport implements CodexAppServerTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<(message: unknown) => void>();
  private readonly lines;

  constructor(command: string, args: readonly string[], env: NodeJS.ProcessEnv) {
    this.child = spawn(command, [...args], { shell: false, stdio: ["pipe", "pipe", "pipe"], env: redactChildEnvironment(env) });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      try {
        const message: unknown = JSON.parse(line);
        for (const listener of this.listeners) listener(message);
      } catch {
        // Ignore non-JSON diagnostics. The app-server protocol is stdout JSONL.
      }
    });
    // Drain stderr without forwarding provider/account details to logs.
    this.child.stderr.resume();
  }

  send(message: unknown): void {
    if (!this.child.stdin.destroyed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.lines.close();
    if (!this.child.killed) this.child.kill();
  }
}

export class CodexAppServerClient {
  private readonly transport: CodexAppServerTransport;
  private readonly requestTimeoutMs: number;
  private readonly clientInfo: NonNullable<CodexAppServerOptions["clientInfo"]>;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly logins = new Map<string, CodexLoginStatus>();
  private nextRequestId = 1;
  private initialized?: Promise<void>;
  private closed = false;
  private readonly unsubscribe: () => void;

  constructor(options: CodexAppServerOptions = {}) {
    this.transport = options.transport ?? new StdioTransport(options.command ?? "codex", options.args ?? ["app-server"], options.env ?? process.env);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.clientInfo = options.clientInfo ?? { name: "maestro", title: "Maestro", version: "development" };
    this.unsubscribe = this.transport.onMessage((message) => this.handleMessage(message));
  }

  async startChatGptLogin(): Promise<CodexManagedLogin> {
    await this.ensureInitialized();
    const result = await this.requestRaw("account/login/start", { type: "chatgpt" });
    if (!isRecord(result) || result.type !== "chatgpt") throw new Error("Codex app-server did not start ChatGPT login");
    const loginId = requiredString(result.loginId, "loginId");
    const authUrl = validateAuthUrl(result.authUrl);
    this.logins.set(loginId, { loginId, state: "pending" });
    return { providerId: "openai-codex", loginId, authUrl };
  }

  async loginStatus(loginId: string): Promise<CodexLoginStatus> {
    const status = this.logins.get(loginId);
    if (status === undefined) throw new Error("Codex login session is unknown");
    return status;
  }

  async cancelLogin(loginId: string): Promise<void> {
    if (!this.logins.has(loginId)) throw new Error("Codex login session is unknown");
    await this.requestRaw("account/login/cancel", { loginId });
    this.logins.set(loginId, { loginId, state: "cancelled" });
  }

  async accountRead(): Promise<CodexAccountSummary> {
    await this.ensureInitialized();
    const result = await this.requestRaw("account/read", { refreshToken: false });
    const account = isRecord(result) && isRecord(result.account) ? result.account : undefined;
    const type = account?.type;
    const authMode = type === "chatgpt" ? "chatgpt" : type === "apiKey" ? "apikey" : type === "personalAccessToken" ? "personalAccessToken" : account === undefined ? "null" : "unknown";
    return {
      authMode,
      ...(typeof account?.email === "string" ? { email: account.email } : {}),
      ...(typeof account?.planType === "string" ? { planType: account.planType } : {}),
    };
  }

  async logout(): Promise<void> {
    await this.ensureInitialized();
    await this.requestRaw("account/logout");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex app-server closed"));
    }
    this.pending.clear();
    await this.transport.close();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.closed) throw new Error("Codex app-server is closed");
    this.initialized ??= this.initialize();
    return this.initialized;
  }

  private async initialize(): Promise<void> {
    await this.requestRaw("initialize", { clientInfo: this.clientInfo });
    this.transport.send({ method: "initialized" });
  }

  private requestRaw(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Codex app-server is closed"));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({ method, id, ...(params === undefined ? {} : { params }) });
    });
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message)) return;
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      const response = message as JsonRpcResponse;
      if (isRecord(response.error)) pending.reject(new Error(typeof response.error.message === "string" ? response.error.message : "Codex app-server request failed"));
      else pending.resolve(response.result);
      return;
    }
    if (typeof message.method !== "string") return;
    const notification = message as JsonRpcNotification;
    if (notification.method !== "account/login/completed" || !isRecord(notification.params)) return;
    const loginId = notification.params.loginId;
    if (typeof loginId !== "string") return;
    if (notification.params.success === true) this.logins.set(loginId, { loginId, state: "succeeded" });
    else this.logins.set(loginId, { loginId, state: "failed", message: typeof notification.params.error === "string" && notification.params.error ? notification.params.error : "Codex account login failed" });
  }
}
