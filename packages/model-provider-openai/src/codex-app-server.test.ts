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
