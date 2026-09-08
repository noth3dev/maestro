import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it } from "vitest";
import { IPYTHON_PYTHON_BOOTSTRAP } from "./ipython-bootstrap.js";
import { createIpPythonProcessKernel, createIpPythonReadOnlyGateway, createReadOnlyHostRequestHandler, type IpPythonLineChannel } from "./ipython-host.js";

class FakeProcessChannel implements IpPythonLineChannel {
  readonly writes: string[] = [];
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly closeListeners = new Set<(reason?: string) => void>();
  write(data: string): void { this.writes.push(data); }
  onData(listener: (chunk: string) => void): () => void { this.dataListeners.add(listener); return () => this.dataListeners.delete(listener); }
  onClose(listener: (reason?: string) => void): () => void { this.closeListeners.add(listener); return () => this.closeListeners.delete(listener); }
  close(): void { for (const listener of this.closeListeners) listener("closed"); }
  emit(frame: unknown): void { for (const listener of this.dataListeners) listener(`${JSON.stringify(frame)}\n`); }
}



class PythonChildChannel implements IpPythonLineChannel {
  private readonly child: ChildProcessWithoutNullStreams;
  constructor() { this.child = spawn("python3", ["-I", "-S", "-c", IPYTHON_PYTHON_BOOTSTRAP], { stdio: ["pipe", "pipe", "ignore"] }); }
  write(data: string): void { this.child.stdin.write(data); }
  onData(listener: (chunk: Buffer) => void): () => void { this.child.stdout.on("data", listener); return () => { this.child.stdout.off("data", listener); }; }
  onClose(listener: (reason?: string) => void): () => void { const wrapped = () => listener("python-child-closed"); this.child.on("close", wrapped); return () => { this.child.off("close", wrapped); }; }
  close(): void { this.child.stdin.end(); this.child.kill("SIGKILL"); }
  terminate(): void { this.child.kill("SIGKILL"); }
}

describe("IPython process kernel composition", () => {
  it("creates a session-bound channel through the injected process factory", async () => {
    const channels = new Map<string, FakeProcessChannel>();
    const sessionId = "[\"project\",\"goal\",\"conversation\"]";
    const kernel = createIpPythonProcessKernel({
      createProcess: (sessionId) => { const channel = new FakeProcessChannel(); channels.set(sessionId, channel); return channel; },
      hostRequest: async () => ({ state: "error", dataClass: "workspace", content: "not used" }),
    }, sessionId);
    const channel = channels.get(sessionId)!;
    channel.emit({ version: 1, type: "ready", runtime: "python" });
    const pending = kernel.execute({ sessionId, code: "print('hello')" });
    const execute = JSON.parse(channel.writes[0]);
    expect(execute).toMatchObject({ version: 1, type: "execute", sessionId, code: "print('hello')" });
    channel.emit({ version: 1, type: "done", requestId: execute.requestId, state: "ok", dataClass: "workspace", content: "hello" });
    await expect(pending).resolves.toEqual({ state: "ok", dataClass: "workspace", content: "hello" });
  });

  it("fails closed when the child never completes the ready handshake", async () => {
    const channel = new FakeProcessChannel();
    const kernel = createIpPythonProcessKernel({ createProcess: () => channel, hostRequest: async () => ({ state: "error", dataClass: "workspace", content: "not used" }), readyTimeoutMs: 1 }, "session-timeout");
    await expect(kernel.execute({ sessionId: "session-timeout", code: "print('never')" })).resolves.toMatchObject({ state: "unknown", reason: "handshake_timeout" });
    expect(channel.writes).toEqual([]);
    await kernel.close();
  });

  it("reports an unknown outcome when the real child dies mid-cell", async () => {
    let channel: PythonChildChannel | undefined;
    const binding = { sessionId: "session-death", commandId: "command-death", toolCallId: "tool-death", operatorId: "operator-death", projectId: "project-death", goalId: "goal-death", pathScope: ["/workspace/project-death"], outboundDataClasses: ["workspace"] } as const;
    const kernel = createIpPythonProcessKernel({
      createProcess: () => { channel = new PythonChildChannel(); return channel; },
      hostRequest: async () => ({ state: "ok" as const, dataClass: "workspace" as const, content: "unused" }),
    }, binding.sessionId, binding);
    const pending = kernel.execute({ sessionId: binding.sessionId, code: "while True: pass", binding });
    setTimeout(() => channel?.terminate(), 100);
    await expect(pending).resolves.toMatchObject({ state: "unknown", reason: "child_closed" });
    await kernel.close();
  });

  it("composes the real constrained child with the read-only host router", async () => {
    const binding = { sessionId: "session-2", commandId: "command-2", toolCallId: "tool-2", operatorId: "operator-2", projectId: "project-2", goalId: "goal-2", pathScope: ["/workspace/project-2"], outboundDataClasses: ["workspace"] } as const;
    const hostRequest = createReadOnlyHostRequestHandler({
      binding,
      gateway: createIpPythonReadOnlyGateway({
        readFile: async (_binding, path) => `evidence:${path}`,
        gitRevision: async () => "abc123",
      }),
    });
    const kernel = createIpPythonProcessKernel({ createProcess: () => new PythonChildChannel(), hostRequest }, binding.sessionId, binding);
    try {
      await expect(kernel.execute({ sessionId: binding.sessionId, code: "print(read_file('README.md'))", binding })).resolves.toMatchObject({ state: "ok", content: "evidence:README.md\n" });
    } finally { await kernel.close(); }
  });

});
