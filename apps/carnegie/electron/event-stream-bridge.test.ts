import { describe, expect, it } from "vitest";
import {
  EVENT_STREAM_CHANNELS,
  createRendererEventStream,
  pumpEventStream,
  type EventStreamIpcPort,
  type EventStreamMessage,
} from "./event-stream-bridge.js";

const query = { projectId: "11111111-1111-4111-8111-111111111111", after: "4" };
const event = {
  eventId: "22222222-2222-4222-8222-222222222222",
  cursor: "5",
  projectId: query.projectId,
  goalId: "33333333-3333-4333-8333-333333333333",
  aggregateVersion: "5",
  eventType: "goal.updated",
  schemaVersion: 1,
  payload: {},
  occurredAt: "2026-01-01T00:00:00.000Z",
};

class FakePort implements EventStreamIpcPort {
  sent: unknown[][] = [];
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  send(channel: string, ...args: unknown[]): void { this.sent.push([channel, ...args]); }
  on(channel: string, listener: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }
  removeListener(channel: string, listener: (...args: unknown[]) => void): void { this.listeners.get(channel)?.delete(listener); }
  emit(channel: string, ...args: unknown[]): void { for (const listener of this.listeners.get(channel) ?? []) listener(...args); }
}

describe("Carnegie Electron durable event bridge", () => {
  it("adapts one IPC stream into an async iterator and closes on end", async () => {
    const port = new FakePort();
    const stream = createRendererEventStream(port, query, () => "stream-1");
    const next = stream[Symbol.asyncIterator]().next();
    expect(port.sent).toEqual([[EVENT_STREAM_CHANNELS.start, "stream-1", query]]);
    port.emit(EVENT_STREAM_CHANNELS.message, {}, "stream-1", { kind: "event", event });
    expect(await next).toEqual({ done: false, value: event });
    const done = stream[Symbol.asyncIterator]().next();
    port.emit(EVENT_STREAM_CHANNELS.message, "stream-1", { kind: "end" });
    expect(await done).toEqual({ done: true, value: undefined });
  });

  it("hands stream failure back to the polling owner and stops IPC on cancellation", async () => {
    const port = new FakePort();
    const controller = new AbortController();
    const stream = createRendererEventStream(port, query, () => "stream-2", controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    port.emit(EVENT_STREAM_CHANNELS.message, "stream-2", { kind: "error", message: "SSE unavailable" });
    await expect(next).rejects.toThrow("SSE unavailable");
    expect(port.sent).toEqual([[EVENT_STREAM_CHANNELS.start, "stream-2", query]]);

    const second = createRendererEventStream(port, query, () => "stream-3", controller.signal);
    const pending = second[Symbol.asyncIterator]().next();
    controller.abort();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(port.sent.at(-1)).toEqual([EVENT_STREAM_CHANNELS.stop, "stream-3"]);
  });

  it("emits events, completion, and non-abort errors without leaking credentials", async () => {
    const messages: EventStreamMessage[] = [];
    await pumpEventStream(async function* () { yield event; }, query, new AbortController().signal, (message) => messages.push(message));
    expect(messages).toEqual([{ kind: "event", event }, { kind: "end" }]);

    const failed: EventStreamMessage[] = [];
    await pumpEventStream(async function* () { yield* [] as typeof event[]; throw new Error("gateway down"); }, query, new AbortController().signal, (message) => failed.push(message));
    expect(failed).toEqual([{ kind: "error", message: "gateway down" }]);
    expect(JSON.stringify(messages)).not.toContain("Bearer");
  });
});
