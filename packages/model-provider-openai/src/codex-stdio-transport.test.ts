import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodexAppServerClient } from "./codex-app-server.js";

const fixturePath = fileURLToPath(new URL("../test/fake-codex-app-server.mjs", import.meta.url));

describe("Codex app-server transport over a real child process", () => {
  it("spawns a real process, completes a full JSON-RPC turn over stdio, and redacts secret-looking env vars before the child ever sees them", async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      args: [fixturePath],
      // A genuine secret-looking variable name (matches
      // redactChildEnvironment's pattern) must never reach the real child
      // process. If it did, the fixture would echo it back instead of
      // "REDACTED" in the delta text below.
      env: { ...process.env, OPENAI_API_KEY: "leaked-secret-value" },
    });
    try {
      const result = await client.runTextTurn({
        model: "gpt-5-codex", requestId: "request-1", messages: [{ role: "user", content: [{ kind: "text", text: "hello" }] }],
        tools: [], signal: new AbortController().signal, maxOutputTokens: 100, emit: () => {},
      });
      expect(result).toMatchObject({ requestId: "request-1", model: { provider: "openai-codex", id: "gpt-5-codex" }, stopReason: "end_turn" });
      expect(result.text).toBe("secret-probe:REDACTED");
    } finally {
      await client.close();
    }
  });

  it("reports a real process failure through onError when the child exits unexpectedly", async () => {
    const client = new CodexAppServerClient({ command: process.execPath, args: ["-e", "process.exit(1)"] });
    try {
      await expect(client.accountRead()).rejects.toThrow(/unavailable/);
    } finally {
      await client.close();
    }
  });
});
