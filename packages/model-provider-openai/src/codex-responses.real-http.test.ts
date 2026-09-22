import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexResponsesPlugin } from "./codex-responses.js";
import type { ModelTurnRequest } from "@maestro/agent-runtime";

function baseRequest(overrides: Partial<ModelTurnRequest> = {}): ModelTurnRequest {
  return {
    requestId: "request-1", sessionId: "session-1", turnId: "turn-1",
    messages: [{ role: "user", content: [{ kind: "text", text: "reply with pong" }] }],
    tools: [],
    limits: { maxModelTurns: 2, maxToolCalls: 4, maxChildCalls: 1, maxOutputTokens: 128, maxInputBytes: 4096, maxResultBytes: 4096, providerTimeoutMs: 5000, wallTimeMs: 10000 },
    signal: new AbortController().signal,
    emit: vi.fn(),
    ...overrides,
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
  return `http://127.0.0.1:${address.port}`;
}

function sseEvent(res: import("node:http").ServerResponse, type: string, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
}

describe("Codex Responses provider adapter over a real HTTP/SSE server", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it("sends real auth/account headers and parses a real text-only SSE stream", async () => {
    let receivedAuth: string | undefined;
    let receivedAccountId: string | undefined;
    let receivedBody: unknown;
    server = createServer((req, res) => {
      receivedAuth = req.headers.authorization;
      receivedAccountId = req.headers["chatgpt-account-id"] as string | undefined;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "content-type": "text/event-stream" });
        sseEvent(res, "response.output_text.delta", { delta: "pong" });
        sseEvent(res, "response.completed", { response: { usage: { total_tokens: 7 } } });
        res.end();
      });
    });
    const baseUrl = await listen(server);
    const plugin = createCodexResponsesPlugin({
      resolveAccessToken: async (accountRef) => { expect(accountRef).toBe("account-1"); return { accessToken: "real-access-token", accountId: "acct-real" }; },
      models: ["codex-test"],
      baseUrl,
    });
    const provider = await plugin.create({
      model: { provider: "openai-codex", id: "codex-test" },
      account: { providerId: "openai-codex", accountRef: "account-1", authMode: "managed-subscription" },
      dataPolicyHash: "policy-1",
    });

    const request = baseRequest();
    const result = await provider.turn(request);

    expect(receivedAuth).toBe("Bearer real-access-token");
    expect(receivedAccountId).toBe("acct-real");
    expect(receivedBody).toMatchObject({ model: "codex-test", stream: true, store: false });
    expect(result).toMatchObject({ text: "pong", stopReason: "end_turn" });
    expect(result.usage).toEqual({ state: "available", totalTokens: 7 });
    expect(request.emit).toHaveBeenCalledWith({ kind: "text-delta", cursor: 1, text: "pong" });
  });

  it("sends real tool definitions and parses a real function-call SSE stream into a tool-proposed result", async () => {
    let receivedBody: { tools?: unknown[] } | undefined;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { tools?: unknown[] };
        res.writeHead(200, { "content-type": "text/event-stream" });
        sseEvent(res, "response.output_item.added", { item: { id: "item-1", type: "function_call", call_id: "call-1", name: "task-contract:create", arguments: "" } });
        sseEvent(res, "response.function_call_arguments.delta", { item_id: "item-1", delta: '{"desiredOutcome":' });
        sseEvent(res, "response.function_call_arguments.delta", { item_id: "item-1", delta: '"ship it"}' });
        sseEvent(res, "response.output_item.done", { item: { id: "item-1", type: "function_call", call_id: "call-1", name: "task-contract:create", arguments: '{"desiredOutcome":"ship it"}' } });
        sseEvent(res, "response.completed", { response: { usage: { total_tokens: 12 } } });
        res.end();
      });
    });
    const baseUrl = await listen(server);
    const plugin = createCodexResponsesPlugin({
      resolveAccessToken: async () => ({ accessToken: "real-access-token", accountId: "acct-real" }),
      models: ["codex-test"],
      baseUrl,
    });
    const provider = await plugin.create({
      model: { provider: "openai-codex", id: "codex-test" },
      account: { providerId: "openai-codex", accountRef: "account-1", authMode: "managed-subscription" },
      dataPolicyHash: "policy-1",
    });

    const request = baseRequest({
      tools: [{ name: "task-contract:create", version: "1", description: "draft", inputSchema: { type: "object" }, outputSchema: { type: "object" }, allowsParallel: false, outboundDataClass: "workspace" }],
    });
    const result = await provider.turn(request);

    expect(receivedBody?.tools).toEqual([{ type: "function", name: "task-contract:create", description: "draft", parameters: { type: "object" }, strict: false }]);
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toEqual([{ id: "call-1", name: "task-contract:create", arguments: { state: "valid", value: { desiredOutcome: "ship it" } } }]);
    expect(request.emit).toHaveBeenCalledWith({ kind: "tool-proposed", cursor: 1, call: result.toolCalls[0] });
  });

  it("sends a prior tool result back to Codex as a real function_call_output input item, not silently dropped", async () => {
    let receivedBody: { input?: Record<string, unknown>[] } | undefined;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { input?: Record<string, unknown>[] };
        res.writeHead(200, { "content-type": "text/event-stream" });
        sseEvent(res, "response.output_text.delta", { delta: "done" });
        sseEvent(res, "response.completed", { response: { usage: { total_tokens: 3 } } });
        res.end();
      });
    });
    const baseUrl = await listen(server);
    const plugin = createCodexResponsesPlugin({ resolveAccessToken: async () => ({ accessToken: "t", accountId: "a" }), models: ["codex-test"], baseUrl });
    const provider = await plugin.create({
      model: { provider: "openai-codex", id: "codex-test" },
      account: { providerId: "openai-codex", accountRef: "account-1", authMode: "managed-subscription" },
      dataPolicyHash: "policy-1",
    });

    const request = baseRequest({
      messages: [
        { role: "user", content: [{ kind: "text", text: "create the draft" }] },
        { role: "assistant", content: [{ kind: "tool-call", call: { id: "call-1", name: "task-contract:create", arguments: { state: "valid", value: {} } } }] },
        { role: "tool", content: [{ kind: "tool-result", toolCallId: "call-1", status: "ok", content: "created", origin: "host", trust: "untrusted-data" }] },
      ],
    });
    await provider.turn(request);

    expect(receivedBody?.input).toContainEqual({ type: "function_call_output", call_id: "call-1", output: "created" });
    expect(receivedBody?.input).not.toContainEqual(expect.objectContaining({ role: "tool" }));
  });

  it("genuinely aborts a real in-flight HTTP connection on cancel", async () => {
    let serverSawClose = false;
    const serverReceivedRequest = new Promise<void>((resolveReceived) => {
      server = createServer((req, res) => {
        req.on("close", () => { serverSawClose = true; });
        resolveReceived();
        req.on("data", () => {});
        void res;
      });
    });
    const baseUrl = await listen(server);
    const plugin = createCodexResponsesPlugin({ resolveAccessToken: async () => ({ accessToken: "t", accountId: "a" }), models: ["codex-test"], baseUrl });
    const provider = await plugin.create({
      model: { provider: "openai-codex", id: "codex-test" },
      account: { providerId: "openai-codex", accountRef: "account-1", authMode: "managed-subscription" },
      dataPolicyHash: "policy-1",
    });

    const request = baseRequest();
    const pending = provider.turn(request);
    await serverReceivedRequest;
    const cancellation = await provider.cancel(request.requestId);
    expect(cancellation).toEqual({ state: "requested", providerRequestRef: request.requestId });
    await expect(pending).rejects.toMatchObject({ code: "provider_cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(serverSawClose).toBe(true);
  });

  it("maps a real 401 response to provider_auth", async () => {
    server = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid token" } }));
    });
    const baseUrl = await listen(server);
    const plugin = createCodexResponsesPlugin({ resolveAccessToken: async () => ({ accessToken: "bad", accountId: "a" }), models: ["codex-test"], baseUrl });
    const provider = await plugin.create({
      model: { provider: "openai-codex", id: "codex-test" },
      account: { providerId: "openai-codex", accountRef: "account-1", authMode: "managed-subscription" },
      dataPolicyHash: "policy-1",
    });

    await expect(provider.turn(baseRequest())).rejects.toMatchObject({ code: "provider_auth" });
  });
});
