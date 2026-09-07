#!/usr/bin/env node
// A real child process (not an in-memory transport fake) speaking the exact
// JSON-RPC-over-stdout-JSONL wire protocol CodexAppServerClient's
// StdioTransport implementation expects. Used only to prove the transport
// layer itself -- real process spawn, stdio piping, JSONL framing, and
// environment redaction -- genuinely works as a real OS process boundary,
// since the real `codex` binary is not installable in every CI/sandbox
// environment. This is not a simulation of Codex's actual model behavior.
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on("line", (line) => {
  if (line.trim() === "") return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialized") return; // notification, no reply
  const { method, id } = message;
  if (method === "initialize") { send({ id, result: { userAgent: "fake-codex-fixture" } }); return; }
  if (method === "account/read") {
    send({ id, result: { account: { type: "chatgpt", email: "codex-fixture@example.com", planType: "pro" } } });
    return;
  }
  if (method === "thread/start") { send({ id, result: { thread: { id: "thread-1" } } }); return; }
  if (method === "turn/start") {
    send({ id, result: { turn: { id: "turn-1", status: "inProgress" } } });
    // Reflect whatever this real child process actually received in its own
    // environment. If Maestro's env redaction genuinely worked, this probe
    // variable never reaches this process and the fixture reports REDACTED.
    const probe = process.env.OPENAI_API_KEY ?? "REDACTED";
    setTimeout(() => {
      send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turn: { id: "turn-1" }, delta: `secret-probe:${probe}` } });
      send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });
    }, 10);
    return;
  }
  if (method === "turn/interrupt") { send({ id, result: {} }); return; }
});
