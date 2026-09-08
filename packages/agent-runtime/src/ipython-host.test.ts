import { describe, expect, it, vi } from "vitest";
import { createIpPythonKernel, parseIpPythonFrame, type IpPythonTransport } from "./ipython-host.js";

class FakeTransport implements IpPythonTransport {
  readonly sent: unknown[] = [];
  readonly interrupts: string[] = [];
  private readonly frameListeners = new Set<(frame: unknown) => void>();
  private readonly closeListeners = new Set<(reason?: string) => void>();

  send(frame: unknown): void { this.sent.push(frame); }
  onFrame(listener: (frame: unknown) => void): () => void { this.frameListeners.add(listener); return () => this.frameListeners.delete(listener); }
  onClose(listener: (reason?: string) => void): () => void { this.closeListeners.add(listener); return () => this.closeListeners.delete(listener); }
  interrupt(requestId: string): void { this.interrupts.push(requestId); }
  close(): void { for (const listener of this.closeListeners) listener("closed"); }
  emit(frame: unknown): void { for (const listener of this.frameListeners) listener(frame); }
}

const done = (requestId: string, content = "read-only") => ({ version: 1, type: "done", requestId, state: "ok", dataClass: "workspace", content });

describe("IPython host protocol", () => {
  it("rejects unknown protocol versions and frame types", () => {
    expect(() => parseIpPythonFrame({ version: 2, type: "done" })).toThrow("protocol version");
    expect(() => parseIpPythonFrame({ version: 1, type: "unknown" })).toThrow("frame type");
  });

  it("handles host requests out of band while one cell is executing", async () => {
    const transport = new FakeTransport();
    const hostRequest = vi.fn(async (request: { method: string; payload: unknown }) => ({ state: "ok", dataClass: "workspace", content: `${request.method}:${JSON.stringify(request.payload)}` }));
    const kernel = createIpPythonKernel({ transport, hostRequest });
    const pending = kernel.execute({ sessionId: "session-1", code: "show_lines('README.md')" });
    const executeFrame = transport.sent[0] as { requestId: string };
    transport.emit({ version: 1, type: "host_request", requestId: executeFrame.requestId, hostRequestId: "host-1", method: "read_file", payload: { path: "README.md" } });
    await vi.waitFor(() => expect(hostRequest).toHaveBeenCalledOnce());
    expect(transport.sent).toContainEqual(expect.objectContaining({ version: 1, type: "host_response", requestId: executeFrame.requestId, hostRequestId: "host-1", ok: true }));

    transport.emit(done(executeFrame.requestId));
    await expect(pending).resolves.toEqual({ state: "ok", dataClass: "workspace", content: "read-only" });
  });

  it("rejects a second cell while the kernel is busy and interrupts the active request", async () => {
    const transport = new FakeTransport();
    const kernel = createIpPythonKernel({ transport, hostRequest: async () => ({ state: "ok", dataClass: "workspace", content: "unused" }) });
    const first = kernel.execute({ sessionId: "session-1", code: "long_running()" });
    const requestId = (transport.sent[0] as { requestId: string }).requestId;

    await expect(kernel.execute({ sessionId: "session-1", code: "second()" })).rejects.toThrow("busy");
    await kernel.interrupt?.("session-1");
    expect(transport.interrupts).toEqual([requestId]);
    transport.emit({ version: 1, type: "done", requestId, state: "cancelled", dataClass: "workspace", content: "cancelled", reason: "user_stop" });
    await expect(first).resolves.toMatchObject({ state: "cancelled", reason: "user_stop" });
  });

  it("returns an unknown outcome when the child closes during execution", async () => {
    const transport = new FakeTransport();
    const kernel = createIpPythonKernel({ transport, hostRequest: async () => ({ state: "ok", dataClass: "workspace", content: "unused" }) });
    const pending = kernel.execute({ sessionId: "session-1", code: "crash()" });
    transport.close();
    await expect(pending).resolves.toMatchObject({ state: "unknown", reason: "child_closed" });
  });
});
