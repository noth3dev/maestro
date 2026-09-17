import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveCodexAppServerCommand } from "../../../apps/cli/src/tui/local-bootstrap.js";
import { CodexAppServerClient, createCodexAppServerPlugin, type CodexAppServerTransport } from "./codex-app-server.js";

class SilentTransport implements CodexAppServerTransport {
  onMessage(_listener: (message: unknown) => void): () => void { return () => {}; }
  send(_message: unknown): void {}
  async close(): Promise<void> {}
}

class FakeTransport implements CodexAppServerTransport {
  readonly messages: unknown[] = [];
  private listener?: (message: unknown) => void;
  constructor(private readonly modelListMode: "normal" | "malformed-entry" | "error" = "normal") {}
  onMessage(listener: (message: unknown) => void): () => void { this.listener = listener; return () => { this.listener = undefined; }; }
  send(message: unknown): void {
    this.messages.push(message);
    const request = message as { id?: number; method?: string; params?: { cursor?: string | null } };
    if (request.method === "initialize") queueMicrotask(() => this.listener?.({ id: request.id, result: { userAgent: "codex-test" } }));
    if (request.method === "account/login/start") queueMicrotask(() => this.listener?.({ id: request.id, result: { type: "chatgpt", loginId: "login-1", authUrl: "https://chatgpt.com/oauth?state=opaque" } }));
    if (request.method === "account/login/cancel") queueMicrotask(() => this.listener?.({ id: request.id, result: {} }));
    if (request.method === "account/read") queueMicrotask(() => this.listener?.({ id: request.id, result: { account: { type: "chatgpt", email: "user@example.com", planType: "pro" } } }));
    if (request.method === "model/list") queueMicrotask(() => {
      if (this.modelListMode === "error") {
        this.listener?.({ id: request.id, error: { message: "model listing unavailable" } });
        return;
      }
      const result = this.modelListMode === "malformed-entry"
        ? { data: [{}], nextCursor: null }
        : request.params?.cursor === "page-2"
          ? { data: [{ id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", hidden: false }], nextCursor: null }
          : { data: [{ id: "gpt-5.6-luna", model: "gpt-5.6-luna", displayName: "GPT-5.6-Luna", hidden: false }, { id: "hidden", model: "hidden", displayName: "Hidden", hidden: true }], nextCursor: "page-2" };
      this.listener?.({ id: request.id, result });
    });
    if (request.method === "thread/start") queueMicrotask(() => this.listener?.({ id: request.id, result: { thread: { id: "thread-1" } } }));
    if (request.method === "turn/start") queueMicrotask(() => {
      this.listener?.({ id: request.id, result: { turn: { id: "turn-1", status: "inProgress" } } });
      this.listener?.({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", delta: "Hello from Codex" } });
      this.listener?.({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
    });
  }
  notify(message: unknown): void { this.listener?.(message); }
  async close(): Promise<void> {}
}

function hasChatGptLogin(command: string | undefined): boolean {
  if (command === undefined) return false;
  const status = spawnSync(command, ["login", "status"], { encoding: "utf8" });
  return /logged in using ChatGPT/i.test(`${status.stdout ?? ""}${status.stderr ?? ""}`);
}

const liveCodexCommand = resolveCodexAppServerCommand(process.env.MAESTRO_CODEX_APP_SERVER_COMMAND);
const describeLiveCodex = hasChatGptLogin(liveCodexCommand) ? describe : describe.skip;

describeLiveCodex("live local Codex account login acceptance", () => {
  it("reads the authenticated ChatGPT account through the real installed Codex app-server", async () => {
    const command = liveCodexCommand;
    if (command === undefined) return;
    const status = spawnSync(command, ["login", "status"], { encoding: "utf8" });
    expect(`${status.stdout ?? ""}${status.stderr ?? ""}`).toMatch(/logged in using ChatGPT/i);
    const client = new CodexAppServerClient({ command, args: ["app-server"], requestTimeoutMs: 15_000 });
    try {
      await expect(client.accountRead()).resolves.toMatchObject({ authMode: "chatgpt" });
    } finally {
      await client.close();
    }
  });

  it("reads the currently offered Codex model catalog without a baked-in model name", async () => {
    const command = liveCodexCommand;
    if (command === undefined) return;
    const client = new CodexAppServerClient({ command, args: ["app-server"], requestTimeoutMs: 15_000 });
    try {
      const models = await client.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((model) => model.id.length > 0 && model.displayName.length > 0)).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("Codex app-server transport diagnostics", () => {
  it("distinguishes a local spawn failure from a transport disconnect while preserving provider_unavailable", async () => {
    const spawnFailure = new CodexAppServerClient({
      command: "/definitely-missing-maestro-codex",
      args: ["app-server"],
      requestTimeoutMs: 2_000,
    });
    try {
      await expect(spawnFailure.accountRead()).rejects.toMatchObject({
        code: "provider_unavailable",
        detail: expect.stringContaining("local codex executable"),
      });
    } finally {
      await spawnFailure.close();
    }

    const transportFailure = new CodexAppServerClient({
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
      requestTimeoutMs: 2_000,
    });
    try {
      await expect(transportFailure.accountRead()).rejects.toMatchObject({
        code: "provider_unavailable",
        detail: expect.stringContaining("transport"),
      });
    } finally {
      await transportFailure.close();
    }
  });
});

describe("Codex app-server model catalog", () => {
  it("fetches every visible model across paginated model/list responses", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient({ transport });
    await expect(client.listModels()).resolves.toEqual([
      { id: "gpt-5.6-luna", displayName: "GPT-5.6-Luna" },
      { id: "gpt-5.5", displayName: "GPT-5.5" },
    ]);
    expect(transport.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "model/list", params: { includeHidden: false } }),
      expect.objectContaining({ method: "model/list", params: { cursor: "page-2", includeHidden: false } }),
    ]));
    await client.close();
  });

  it("normalizes initialization timeouts as provider-unavailable catalog failures", async () => {
    const client = new CodexAppServerClient({ transport: new SilentTransport(), requestTimeoutMs: 5 });
    await expect(client.listModels()).rejects.toMatchObject({ code: "provider_unavailable" });
    await client.close();
  });

  it("fails closed on malformed provider catalog entries", async () => {
    const client = new CodexAppServerClient({ transport: new FakeTransport("malformed-entry") });
    await expect(client.listModels()).rejects.toMatchObject({ code: "provider_malformed_response" });
    await client.close();
  });

  it("does not retain or invent a model when provider catalog discovery fails", async () => {
    const client = new CodexAppServerClient({ transport: new FakeTransport("error") });
    const plugin = createCodexAppServerPlugin({ client });
    await expect(plugin.refreshModels?.()).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(plugin.listModels()).toEqual([]);
    await client.close();
  });

  it("single-flights concurrent dynamic catalog refreshes", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient({ transport });
    const plugin = createCodexAppServerPlugin({ client });
    await Promise.all([plugin.refreshModels?.(), plugin.refreshModels?.()]);
    expect(transport.messages.filter((message) => (message as { method?: string }).method === "model/list")).toHaveLength(2);
    await client.close();
  });

  it("refreshes the provider catalog from the app-server when no explicit override is configured", async () => {
    const client = new CodexAppServerClient({ transport: new FakeTransport() });
    const plugin = createCodexAppServerPlugin({ client });
    expect(plugin.listModels()).toEqual([]);
    await plugin.refreshModels?.();
    expect(plugin.listModels().map((model) => model.identity.id)).toEqual(["gpt-5.6-luna", "gpt-5.5"]);
    await client.close();
  });
});

describe("Codex app-server managed login", () => {
  it("initializes the official app-server and starts a ChatGPT browser login without receiving tokens", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient({ transport, clientInfo: { name: "maestro", title: "Maestro", version: "test" } });
    const login = await client.startChatGptLogin();

    expect(login).toEqual({ providerId: "openai-codex", loginId: "login-1", authUrl: "https://chatgpt.com/oauth?state=opaque" });
    expect(transport.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "initialize", params: expect.objectContaining({ clientInfo: { name: "maestro", title: "Maestro", version: "test" } }) }),
      { method: "initialized" },
      { method: "account/login/start", id: expect.any(Number), params: { type: "chatgpt" } },
    ]));
    expect(JSON.stringify(transport.messages)).not.toContain("access_token");
    expect(JSON.stringify(transport.messages)).not.toContain("refresh_token");

    transport.notify({ method: "account/login/completed", params: { loginId: "login-1", success: true, error: null } });
    await expect(client.loginStatus("login-1")).resolves.toEqual({ loginId: "login-1", state: "succeeded" });
    await client.close();
  });

  it("uses the official Codex originator by default", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient({ transport });
    await client.startChatGptLogin();
    const initialize = transport.messages.find((message) => (message as { method?: string }).method === "initialize") as { params: { clientInfo: { name: string } } };
    expect(initialize.params.clientInfo.name).toBe("codex_cli_rs");
    await client.close();
  });

  it("maps failed completion and supports cancellation", async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient({ transport });
    await client.startChatGptLogin();
    transport.notify({ method: "account/login/completed", params: { loginId: "login-1", success: false, error: "cancelled" } });
    await expect(client.loginStatus("login-1")).resolves.toEqual({ loginId: "login-1", state: "failed", message: "cancelled" });
    await expect(client.cancelLogin("login-1")).resolves.toBeUndefined();
    await client.close();
  });
});


it("runs a text turn through the managed app-server and supports cancellation", async () => {
  const transport = new FakeTransport();
  const client = new CodexAppServerClient({ transport });
  transport.notify({ id: 99, result: {} }); // ignored response
  const resultPromise = client.runTextTurn({
    model: "gpt-5.3-codex", requestId: "request-1", messages: [{ role: "user", content: [{ kind: "text", text: "hello" }] }], tools: [],
    signal: new AbortController().signal, maxOutputTokens: 100,
  });
  await expect(resultPromise).resolves.toMatchObject({ requestId: "request-1", model: { provider: "openai-codex", id: "gpt-5.3-codex" }, text: "Hello from Codex" });
  await client.close();
});


it("creates a managed-subscription provider with a text-only catalog", async () => {
  const transport = new FakeTransport();
  const client = new CodexAppServerClient({ transport });
  const plugin = (await import("./codex-app-server.js")).createCodexAppServerPlugin({ client, models: ["gpt-5.3-codex"] });
  expect(plugin.listModels()).toEqual([expect.objectContaining({ identity: { provider: "openai-codex", id: "gpt-5.3-codex" }, authModes: ["managed-subscription"] })]);
  const provider = await plugin.create({ model: { provider: "openai-codex", id: "gpt-5.3-codex" }, account: { providerId: "openai-codex", accountRef: "openai-codex-operator-1", authMode: "managed-subscription" }, dataPolicyHash: "policy" });
  await expect(provider.turn({ requestId: "request-1", sessionId: "session-1", turnId: "turn-1", messages: [], tools: [], limits: { maxModelTurns: 1, maxToolCalls: 0, maxChildCalls: 0, maxOutputTokens: 100, maxInputBytes: 1000, maxResultBytes: 1000, providerTimeoutMs: 1000, wallTimeMs: 1000 }, signal: new AbortController().signal, emit: () => {} })).resolves.toMatchObject({ model: { provider: "openai-codex" } });
  await client.close();
});


it("speaks JSONL to a real shell-free app-server child process", async () => {
  const script = `if(process.env.TEST_API_KEY) process.exit(7); const rl=require("node:readline").createInterface({input:process.stdin}); rl.on("line", line => { const m=JSON.parse(line); if(m.method === "initialize") process.stdout.write(JSON.stringify({id:m.id,result:{}})+"\\n"); if(m.method === "account/login/start") process.stdout.write(JSON.stringify({id:m.id,result:{type:"chatgpt",loginId:"child-login",authUrl:"https://chatgpt.com/login"}})+"\\n"); });`;
  const client = new CodexAppServerClient({ command: process.execPath, args: ["-e", script], env: { ...process.env, TEST_API_KEY: "must-not-cross" }, requestTimeoutMs: 2_000 });
  await expect(client.startChatGptLogin()).resolves.toEqual({ providerId: "openai-codex", loginId: "child-login", authUrl: "https://chatgpt.com/login" });
  await client.close();
});
