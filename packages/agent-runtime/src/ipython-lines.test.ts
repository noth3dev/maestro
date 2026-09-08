import { describe, expect, it } from "vitest";
import { createIpPythonJsonLinesTransport, type IpPythonLineChannel } from "./ipython-host.js";

class FakeLineChannel implements IpPythonLineChannel {
  readonly writes: string[] = [];
  private readonly dataListeners = new Set<(chunk: string) => void>();
  private readonly closeListeners = new Set<(reason?: string) => void>();
  write(data: string): void { this.writes.push(data); }
  onData(listener: (chunk: string) => void): () => void { this.dataListeners.add(listener); return () => this.dataListeners.delete(listener); }
  onClose(listener: (reason?: string) => void): () => void { this.closeListeners.add(listener); return () => this.closeListeners.delete(listener); }
  close(): void { for (const listener of this.closeListeners) listener("closed"); }
  emit(data: string): void { for (const listener of this.dataListeners) listener(data); }
}

describe("IPython JSON-lines transport", () => {
  it("frames outbound messages and parses split inbound UTF-8 lines", () => {
    const channel = new FakeLineChannel();
    const transport = createIpPythonJsonLinesTransport(channel);
    const frames: unknown[] = [];
    transport.onFrame((frame) => frames.push(frame));

    void transport.send({ version: 1, type: "interrupt", requestId: "cell-1" });
    channel.emit('{"version":1,"type":"event","requestId":"cell-1","stream":"stdout",');
    channel.emit('"text":"hello\\nworld"}\n');

    expect(channel.writes).toEqual(['{"version":1,"type":"interrupt","requestId":"cell-1"}\n']);
    expect(frames).toEqual([{ version: 1, type: "event", requestId: "cell-1", stream: "stdout", text: "hello\nworld" }]);
  });

  it("rejects malformed JSON frames through the protocol listener and closes with shutdown", async () => {
    const channel = new FakeLineChannel();
    const transport = createIpPythonJsonLinesTransport(channel);
    const frames: unknown[] = [];
    transport.onFrame((frame) => frames.push(frame));

    channel.emit("not-json\n");
    await transport.close();

    expect(frames).toEqual([undefined]);
    expect(channel.writes).toEqual(['{"version":1,"type":"shutdown"}\n']);
  });
});
