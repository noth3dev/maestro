import { describe, expect, it } from "vitest";
import {
  createRendererEventStream,
  pumpEventStream,
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

class FakeSubscriber {
  calls: Array<typeof query> = [];
  listener: ((message: EventStreamMessage) => void) | undefined;
  unsubscribeCount = 0;
  subscribe(receivedQuery: typeof query, listener: (message: EventStreamMessage) => void): () => void {
    this.calls.push(receivedQuery);
    this.listener = listener;
    return () => { this.unsubscribeCount += 1; this.listener = undefined; };
  }
  emit(message: EventStreamMessage): void { this.listener?.(message); }
}

describe("Carnegie Electron durable event bridge", () => {
  it("adapts one IPC stream into an async iterator and closes on end", async () => {
    const subscriber = new FakeSubscriber();
    let connected = false;
    const stream = createRendererEventStream(subscriber.subscribe.bind(subscriber), query, undefined, () => { connected = true; });
    const next = stream[Symbol.asyncIterator]().next();
    expect(subscriber.calls).toEqual([query]);
    expect(connected).toBe(false);
    subscriber.emit({ kind: "connected" });
    expect(connected).toBe(true);
    subscriber.emit({ kind: "event", event });
    expect(await next).toEqual({ done: false, value: event });
    const done = stream[Symbol.asyncIterator]().next();
    subscriber.emit({ kind: "end" });
    expect(await done).toEqual({ done: true, value: undefined });
    expect(subscriber.unsubscribeCount).toBe(1);
  });

  it("hands stream failure back to the polling owner and stops IPC on cancellation", async () => {
    const subscriber = new FakeSubscriber();
    const controller = new AbortController();
    const stream = createRendererEventStream(subscriber.subscribe.bind(subscriber), query, controller.signal);
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    subscriber.emit({ kind: "error", message: "SSE unavailable" });
    await expect(next).rejects.toThrow("SSE unavailable");
    expect(subscriber.calls).toEqual([query]);

    const second = createRendererEventStream(subscriber.subscribe.bind(subscriber), query, controller.signal);
    const pending = second[Symbol.asyncIterator]().next();
    controller.abort();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(subscriber.unsubscribeCount).toBe(2);
  });

  it("emits events, completion, and non-abort errors without leaking credentials", async () => {
    const messages: EventStreamMessage[] = [];
    await pumpEventStream(async function* () { yield event; }, query, new AbortController().signal, (message) => messages.push(message));
    expect(messages).toEqual([{ kind: "connected" }, { kind: "event", event }, { kind: "end" }]);

    const failed: EventStreamMessage[] = [];
    await pumpEventStream(async function* () { yield* [] as typeof event[]; throw new Error("gateway down token=provider-secret"); }, query, new AbortController().signal, (message) => failed.push(message));
    expect(failed).toEqual([{ kind: "error", message: "gateway down token=[redacted]" }]);
    expect(JSON.stringify(failed)).not.toContain("provider-secret");
  });
});
