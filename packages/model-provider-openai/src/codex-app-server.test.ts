import { describe, expect, it } from "vitest";
import { CodexAppServerClient, type CodexAppServerTransport } from "./codex-app-server.js";

class FakeTransport implements CodexAppServerTransport {
  readonly messages: unknown[] = [];
  private listener?: (message: unknown) => void;
  onMessage(listener: (message: unknown) => void): () => void { this.listener = listener; return () => { this.listener = undefined; }; }
  send(message: unknown): void {
    this.messages.push(message);
    const request = message as { id?: number; method?: string };
    if (request.method === "initialize") queueMicrotask(() => this.listener?.({ id: request.id, result: { userAgent: "codex-test" } }));
    if (request.method === "account/login/start") queueMicrotask(() => this.listener?.({ id: request.id, result: { type: "chatgpt", loginId: "login-1", authUrl: "https://chatgpt.com/oauth?state=opaque" } }));
    if (request.method === "account/login/cancel") queueMicrotask(() => this.listener?.({ id: request.id, result: {} }));
    if (request.method === "account/read") queueMicrotask(() => this.listener?.({ id: request.id, result: { account: { type: "chatgpt", email: "user@example.com", planType: "pro" } } }));
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
