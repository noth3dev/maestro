import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { IPYTHON_PYTHON_BOOTSTRAP } from "./ipython-bootstrap.js";

type Frame = Record<string, unknown>;

class FrameReader {
  private buffer = "";
  private frames: Frame[] = [];
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      for (;;) {
        const newline = this.buffer.indexOf("\n");
        if (newline < 0) return;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.trim()) this.frames.push(JSON.parse(line) as Frame);
      }
    });
  }

  async wait(predicate: (frame: Frame) => boolean): Promise<Frame> {
    const deadline = Date.now() + 2_000;
    for (;;) {
      const index = this.frames.findIndex(predicate);
      if (index >= 0) return this.frames.splice(index, 1)[0]!;
      if (Date.now() >= deadline) throw new Error("timed out waiting for Python frame");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

function send(child: ChildProcessWithoutNullStreams, frame: Frame): void { child.stdin.write(`${JSON.stringify(frame)}\n`); }

async function closeChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  send(child, { version: 1, type: "shutdown" });
  await new Promise<void>((resolve) => child.once("close", () => resolve()));
}

describe("constrained Python IPython bootstrap", () => {
  it("keeps namespace state, bridges host requests, and rejects direct I/O", async () => {
    const child = spawn("python3", ["-I", "-S", "-c", IPYTHON_PYTHON_BOOTSTRAP], { stdio: ["pipe", "pipe", "ignore"] });
    const reader = new FrameReader(child);
    try {
      await expect(reader.wait((frame) => frame.type === "ready")).resolves.toMatchObject({ version: 1, type: "ready", runtime: "python" });
      send(child, { version: 1, type: "execute", requestId: "cell-1", sessionId: "session-1", code: "value = 41\nprint(value)" });
      await expect(reader.wait((frame) => frame.type === "event" && frame.requestId === "cell-1")).resolves.toMatchObject({ stream: "stdout", text: "41" });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-1")).resolves.toMatchObject({ state: "ok", content: "41\n" });

      send(child, { version: 1, type: "execute", requestId: "cell-2", sessionId: "session-1", code: "print(value + 1)" });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-2")).resolves.toMatchObject({ state: "ok", content: "42\n" });
      send(child, { version: 1, type: "execute", requestId: "cell-other-session", sessionId: "session-2", code: "print(value)" });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-other-session")).resolves.toMatchObject({ state: "error", reason: expect.stringContaining("session") });



      send(child, { version: 1, type: "execute", requestId: "cell-stale-1", sessionId: "session-1", code: "old_reader = read_file" });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-stale-1")).resolves.toMatchObject({ state: "ok" });
      send(child, { version: 1, type: "execute", requestId: "cell-stale-2", sessionId: "session-1", code: "print(old_reader('README.md'))" });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-stale-2")).resolves.toMatchObject({ state: "error", reason: expect.stringContaining("expired") });

      send(child, { version: 1, type: "execute", requestId: "cell-3", sessionId: "session-1", code: "print(read_file('README.md'))" });
      const hostRequest = await reader.wait((frame) => frame.type === "host_request" && frame.requestId === "cell-3");
      expect(hostRequest).toMatchObject({ method: "read_file", payload: { path: "README.md" } });
      send(child, { version: 1, type: "host_response", requestId: "cell-3", hostRequestId: hostRequest.hostRequestId, ok: true, result: { state: "ok", dataClass: "workspace", content: "host evidence" } });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-3")).resolves.toMatchObject({ state: "ok", content: "host evidence\n" });
      send(child, { version: 1, type: "execute", requestId: "cell-host-error", sessionId: "session-1", code: "print(read_file('README.md'))" });
      const failedHostRequest = await reader.wait((frame) => frame.type === "host_request" && frame.requestId === "cell-host-error");
      send(child, { version: 1, type: "host_response", requestId: "cell-host-error", hostRequestId: failedHostRequest.hostRequestId, ok: true, result: { state: "error", dataClass: "workspace", content: "denied" } });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-host-error")).resolves.toMatchObject({ state: "error", reason: expect.stringContaining("not successful") });



      send(child, { version: 1, type: "execute", requestId: "cell-4", sessionId: "session-1", code: "import os" });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-4")).resolves.toMatchObject({ state: "error", reason: expect.stringContaining("direct imports") });
      send(child, { version: 1, type: "execute", requestId: "cell-5", sessionId: "session-1", code: "open('secret')" });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-5")).resolves.toMatchObject({ state: "error", reason: expect.stringContaining("direct I/O") });
      send(child, { version: 1, type: "execute", requestId: "cell-6", sessionId: "session-1", code: "print(host.__class__)" });
      await expect(reader.wait((frame) => frame.type === "done" && frame.requestId === "cell-6")).resolves.toMatchObject({ state: "error", reason: expect.stringContaining("dunder") });
    } finally { await closeChild(child); }
  });
});
