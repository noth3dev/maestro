import { describe, expect, it } from "vitest";
import { createIpPythonProcessKernel, type IpPythonLineChannel } from "./ipython-host.js";

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

describe("IPython process kernel composition", () => {
  it("creates a session-bound channel through the injected process factory", async () => {
    const channels = new Map<string, FakeProcessChannel>();
    const sessionId = "[\"project\",\"goal\",\"conversation\"]";
    const kernel = createIpPythonProcessKernel({
      createProcess: (sessionId) => { const channel = new FakeProcessChannel(); channels.set(sessionId, channel); return channel; },
      hostRequest: async () => ({ state: "error", dataClass: "workspace", content: "not used" }),
    }, sessionId);
    const pending = kernel.execute({ sessionId, code: "print('hello')" });
    const channel = channels.get(sessionId)!;
    const execute = JSON.parse(channel.writes[0]);
    expect(execute).toMatchObject({ version: 1, type: "execute", sessionId, code: "print('hello')" });
    channel.emit({ version: 1, type: "done", requestId: execute.requestId, state: "ok", dataClass: "workspace", content: "hello" });
    await expect(pending).resolves.toEqual({ state: "ok", dataClass: "workspace", content: "hello" });
  });
});
