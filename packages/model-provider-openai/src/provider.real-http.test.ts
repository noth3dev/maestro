import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiPlugin } from "./index.js";
import type { ModelTurnRequest } from "@maestro/agent-runtime";

const request: ModelTurnRequest = {
  requestId: "request-1", sessionId: "session-1", turnId: "turn-1",
  messages: [{ role: "user", content: [{ kind: "text", text: "show the Goal" }] }],
  tools: [],
  limits: { maxModelTurns: 2, maxToolCalls: 4, maxChildCalls: 1, maxOutputTokens: 128, maxInputBytes: 4096, maxResultBytes: 4096, providerTimeoutMs: 5000, wallTimeMs: 10000 },
  signal: new AbortController().signal,
  emit: vi.fn(),
};

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
  return `http://127.0.0.1:${address.port}`;
}

describe("OpenAI provider adapter over a real HTTP server", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it("sends a real HTTP request and parses a real HTTP response, not just a hand-built Response object", async () => {
    let receivedAuth: string | undefined;
    let receivedBody: unknown;
    server = createServer((req, res) => {
      receivedAuth = req.headers.authorization;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "resp-1", model: "gpt-test", output: [{ type: "message", content: [{ type: "output_text", text: "real http reply" }] }], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }));
      });
    });
    const baseUrl = await listen(server);
    const provider = await createOpenAiPlugin({ resolveApiKey: async () => "real-api-secret", models: ["gpt-test"], baseUrl }).create({
      model: { provider: "openai", id: "gpt-test" }, account: { providerId: "openai", accountRef: "account-1", authMode: "api-key" }, dataPolicyHash: "policy-1",
    });

    const result = await provider.turn(request);

    expect(receivedAuth).toBe("Bearer real-api-secret");
    expect(receivedBody).toMatchObject({ model: "gpt-test" });
    expect(result).toMatchObject({ model: { provider: "openai", id: "gpt-test" }, text: "real http reply", stopReason: "end_turn" });
    expect(result.usage).toEqual({ state: "available", totalTokens: 3 });
  });

  it("genuinely aborts a real in-flight HTTP connection on cancel, and the server observes the real disconnect", async () => {
    let serverSawClose = false;
    const serverReceivedRequest = new Promise<void>((resolveReceived) => {
      server = createServer((req, res) => {
        req.on("close", () => { serverSawClose = true; });
        resolveReceived();
        // Never respond -- the only way this request ever settles is a real
        // client-side abort of the real TCP connection.
        req.on("data", () => {});
        void res;
      });
    });
    const baseUrl = await listen(server);
    const provider = await createOpenAiPlugin({ resolveApiKey: async () => "real-api-secret", models: ["gpt-test"], baseUrl }).create({
      model: { provider: "openai", id: "gpt-test" }, account: { providerId: "openai", accountRef: "account-1", authMode: "api-key" }, dataPolicyHash: "policy-1",
    });

    const pending = provider.turn(request);
    await serverReceivedRequest;
    const cancellation = await provider.cancel(request.requestId);
    expect(cancellation).toEqual({ state: "requested", providerRequestRef: request.requestId });
    await expect(pending).rejects.toMatchObject({ code: "provider_cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(serverSawClose).toBe(true);
  });
});
