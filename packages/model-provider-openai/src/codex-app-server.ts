import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { ModelMessage, ModelProviderPort, ModelStreamEvent, ModelTurnRequest, ProviderDataPolicy, ProviderModelRequest, ProviderPlugin, ModelCatalogEntry } from "@maestro/agent-runtime";

export interface CodexAppServerTransport {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onError?(listener: (error: Error) => void): () => void;
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

export class CodexAppServerError extends Error {
  readonly name = "CodexAppServerError";
  constructor(readonly code: "provider_auth" | "provider_unavailable" | "provider_cancelled" | "provider_malformed_response" | "account_login_session_unknown", message: string) { super(message); }
}

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
  for (const key of Object.keys(childEnv)) {
    if (/(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|PRIVATE_KEY|PASSWORD|PASSWD|CODEX_TOKEN|MAESTRO_SECRET|MAESTRO_API_TOKEN|MAESTRO_MODEL_GATEWAY_TOKEN)$/i.test(key)) delete childEnv[key];
  }
  return childEnv;
}

class StdioTransport implements CodexAppServerTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
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
    this.child.once("error", (error) => { for (const listener of this.errorListeners) listener(error); });
    this.child.once("exit", (code, signal) => { if (!this.child.killed) { for (const listener of this.errorListeners) listener(new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`)); } });
  }

  send(message: unknown): void {
    if (!this.child.stdin.destroyed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
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
  private readonly notificationListeners = new Set<(message: JsonRpcNotification) => void>();
  private readonly activeTurns = new Map<string, { threadId: string; turnId: string }>();
  private nextRequestId = 1;
  private initialized?: Promise<void>;
  private closed = false;
  private transportError: Error | undefined;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeError: (() => void) | undefined;

  constructor(options: CodexAppServerOptions = {}) {
    this.transport = options.transport ?? new StdioTransport(options.command ?? "codex", options.args ?? ["app-server"], options.env ?? process.env);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.clientInfo = options.clientInfo ?? { name: "maestro", title: "Maestro", version: "development" };
    this.unsubscribe = this.transport.onMessage((message) => this.handleMessage(message));
    this.unsubscribeError = this.transport.onError?.((error) => { this.transportError = new Error("Codex app-server is unavailable"); this.failPending(error); });
  }

  onNotification(listener: (message: JsonRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  async runTextTurn(input: {
    readonly model: string;
    readonly requestId: string;
    readonly messages: readonly ModelMessage[];
    readonly tools: readonly unknown[];
    readonly signal: AbortSignal;
    readonly maxOutputTokens: number;
    readonly emit?: (event: ModelStreamEvent) => void;
  }): Promise<{ requestId: string; model: { provider: "openai-codex"; id: string }; text: string; toolCalls: readonly []; stopReason: "end_turn" | "cancelled"; usage: { state: "unknown" } }> {
    if (input.tools.length > 0) throw new CodexAppServerError("provider_unavailable", "Codex app-server tool bridge is not enabled");
    if (input.signal.aborted) throw new CodexAppServerError("provider_cancelled", "Codex request cancelled");
    const account = await this.accountRead();
    if (account.authMode !== "chatgpt") throw new CodexAppServerError("provider_auth", "ChatGPT account authentication is required");
    const threadResult = await this.requestRaw("thread/start", { model: input.model, approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }, personality: "none" });
    const thread = isRecord(threadResult) && isRecord(threadResult.thread) ? threadResult.thread : undefined;
    const threadId = requiredString(thread?.id, "thread.id");
    const transcript = input.messages.map((message) => {
      const text = message.content.filter((part): part is Extract<ModelMessage["content"][number], { kind: "text" }> => part.kind === "text").map((part) => part.text).join("\n");
      return `${message.role}: ${text}`;
    }).join("\n\n");
    let cleanup = () => {};
    let activeTurnId: string | undefined;
    const notifications = new Promise<{ text: string; status: "completed" | "interrupted" }>((resolve, reject) => {
      let text = "";
      const unsubscribe = this.onNotification((notification) => {
        const params = notification.params;
        if (!isRecord(params) || (params.threadId !== threadId && (!isRecord(params.turn) || params.turn.id !== activeTurnId))) return;
        if (notification.method === "item/agentMessage/delta" && typeof params.delta === "string") {
          text += params.delta;
          input.emit?.({ kind: "text-delta", cursor: text.length, text: params.delta });
        }
        if (notification.method !== "turn/completed" || !isRecord(params.turn)) return;
        const status = params.turn.status;
        if (status === "completed") {
          if (!text && Array.isArray(params.turn.items)) {
            text = params.turn.items.filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "agentMessage" && typeof item.text === "string").map((item) => item.text as string).join("");
          }
          resolve({ text, status });
        } else if (status === "interrupted") resolve({ text, status });
        else if (status === "failed") reject(new CodexAppServerError("provider_unavailable", "Codex app-server turn failed"));
      });
      void this.requestRaw("turn/start", { threadId, input: [{ type: "text", text: transcript }], model: input.model, approvalPolicy: "never", sandboxPolicy: { type: "readOnly" }, maxOutputTokens: input.maxOutputTokens }).then((turnResult) => {
        const turn = isRecord(turnResult) && isRecord(turnResult.turn) ? turnResult.turn : undefined;
        const turnId = requiredString(turn?.id, "turn.id");
        activeTurnId = turnId;
        this.activeTurns.set(input.requestId, { threadId, turnId });
        if (input.signal.aborted) void this.requestRaw("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      }).catch((error: unknown) => reject(error instanceof Error ? error : new Error("Codex app-server turn failed")));
      const onAbort = () => {
        const active = this.activeTurns.get(input.requestId);
        if (active) void this.requestRaw("turn/interrupt", active).catch(() => undefined);
        reject(new CodexAppServerError("provider_cancelled", "Codex request cancelled"));
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      cleanup = () => { unsubscribe(); input.signal.removeEventListener("abort", onAbort); };
    });
    notifications.then(cleanup, cleanup).catch(() => undefined);
    let outcome: { text: string; status: "completed" | "interrupted" };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new CodexAppServerError("provider_unavailable", "Codex app-server turn timed out")), this.requestTimeoutMs); });
      outcome = await Promise.race([notifications, deadline]);
    } catch (error) {
      if (error instanceof CodexAppServerError && error.message.includes("timed out")) {
        const active = this.activeTurns.get(input.requestId);
        if (active) void this.requestRaw("turn/interrupt", active).catch(() => undefined);
      }
      throw error;
    } finally { if (timeout !== undefined) clearTimeout(timeout); this.activeTurns.delete(input.requestId); }
    if (outcome.status === "interrupted") throw new CodexAppServerError("provider_cancelled", "Codex request cancelled");
    return { requestId: input.requestId, model: { provider: "openai-codex", id: input.model }, text: outcome.text, toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
  }

  async cancelTurn(requestId: string): Promise<"requested" | "unsupported"> {
    const active = this.activeTurns.get(requestId);
    if (active === undefined) return "unsupported";
    await this.requestRaw("turn/interrupt", active);
    return "requested";
  }

  async startChatGptLogin(): Promise<CodexManagedLogin> {
    await this.ensureInitialized();
    const result = await this.requestRaw("account/login/start", { type: "chatgpt" });
    if (!isRecord(result) || result.type !== "chatgpt") throw new Error("Codex app-server did not start ChatGPT login");
    const loginId = requiredString(result.loginId, "loginId");
    const authUrl = validateAuthUrl(result.authUrl);
    if (this.logins.get(loginId)?.state !== "succeeded") this.logins.set(loginId, { loginId, state: "pending" });
    return { providerId: "openai-codex", loginId, authUrl };
  }

  async loginStatus(loginId: string): Promise<CodexLoginStatus> {
    const status = this.logins.get(loginId);
    if (status === undefined) throw new CodexAppServerError("account_login_session_unknown", "account login session is unknown");
    return status;
  }

  async cancelLogin(loginId: string): Promise<void> {
    if (!this.logins.has(loginId)) throw new CodexAppServerError("account_login_session_unknown", "account login session is unknown");
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
    this.unsubscribeError?.();
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
    if (this.transportError !== undefined) return Promise.reject(this.transportError);
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

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const [loginId, status] of this.logins) if (status.state === "pending") this.logins.set(loginId, { loginId, state: "failed", message: "Codex app-server is unavailable" });
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
    for (const listener of this.notificationListeners) listener(notification);
    if (notification.method !== "account/login/completed" || !isRecord(notification.params)) return;
    const loginId = notification.params.loginId;
    if (typeof loginId !== "string") return;
    if (notification.params.success === true) this.logins.set(loginId, { loginId, state: "succeeded" });
    else this.logins.set(loginId, { loginId, state: "failed", message: typeof notification.params.error === "string" && notification.params.error ? notification.params.error : "Codex account login failed" });
  }
}


const codexDataPolicy: ProviderDataPolicy = {
  allowedDataClasses: ["public", "workspace"],
  retention: "provider-policy",
  trainsOnCustomerData: false,
  regions: ["us"],
};

class CodexAppServerProvider implements ModelProviderPort {
  readonly capabilities = new Set(["text", "cancellation", "managed-subscription"] as const);

  constructor(readonly identity: { provider: "openai-codex"; id: string }, readonly accountRef: string, private readonly client: CodexAppServerClient) {}

  async turn(request: ModelTurnRequest) {
    return this.client.runTextTurn({
      model: this.identity.id,
      requestId: request.requestId,
      messages: request.messages,
      tools: request.tools,
      signal: request.signal,
      maxOutputTokens: request.limits.maxOutputTokens,
      emit: request.emit,
    });
  }

  async cancel(requestId: string): Promise<{ state: "requested" | "unsupported"; providerRequestRef?: string }> {
    const state = await this.client.cancelTurn(requestId);
    return state === "requested" ? { state, providerRequestRef: requestId } : { state };
  }

  async close(): Promise<void> {}
}

export interface CodexAppServerPluginOptions {
  readonly client: CodexAppServerClient;
  readonly models?: readonly string[];
}

export function createCodexAppServerPlugin(options: CodexAppServerPluginOptions): ProviderPlugin {
  const models = options.models ?? ["gpt-5.3-codex"];
  const catalog = (): readonly ModelCatalogEntry[] => models.map((id) => ({ identity: { provider: "openai-codex", id }, capabilities: new Set(["text", "cancellation", "managed-subscription"] as const), authModes: ["managed-subscription"], dataPolicy: codexDataPolicy }));
  return {
    id: "openai-codex",
    authModes: ["managed-subscription"],
    capabilities: new Set(["text", "cancellation", "managed-subscription"] as const),
    dataPolicy: codexDataPolicy,
    listModels: catalog,
    async create(request: ProviderModelRequest): Promise<ModelProviderPort> {
      if (request.model.provider !== "openai-codex" || request.account.providerId !== "openai-codex" || request.account.authMode !== "managed-subscription") throw new CodexAppServerError("provider_auth", "Codex managed account binding mismatch");
      if (!models.includes(request.model.id)) throw new CodexAppServerError("provider_malformed_response", "Codex model is not in the configured catalog");
      return new CodexAppServerProvider(request.model as { provider: "openai-codex"; id: string }, request.account.accountRef, options.client);
    },
  };
}
