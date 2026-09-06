import { describe, expect, it } from "vitest";
import { mergeEvents, subscribeToEvents } from "./activity-stream.js";

describe("mergeEvents", () => {
  it("deduplicates reconnect overlap by durable cursor", () => {
    const existing = [{ cursor: "1", eventType: "goal.created" }, { cursor: "2", eventType: "goal.running" }];
    const incoming = [{ cursor: "2", eventType: "goal.running" }, { cursor: "3", eventType: "worker.spawned" }];
    expect(mergeEvents(existing, incoming)).toEqual([...existing, incoming[1]]);
  });

  it("deduplicates duplicate identities within one incoming batch", () => {
    const incoming = [{ eventId: "event-1", cursor: "1" }, { eventId: "event-1", cursor: "1" }];
    expect(mergeEvents([], incoming)).toEqual([incoming[0]]);
  });
});


describe("subscribeToEvents", () => {
  it("bounds failed reconnects and reports retry state", async () => {
    const calls: string[] = [];
    const retries: number[] = [];
    const client = { streamEvents: async function* (query: { projectId: string; after: string }) { calls.push(query.after); throw new Error("offline"); } };
    for await (const _event of subscribeToEvents({ client, projectId: "project-1", signal: new AbortController().signal, reconnectDelayMs: 0, maxReconnectAttempts: 2, onReconnect: (attempt) => retries.push(attempt) })) {}
    expect(calls).toHaveLength(3);
    expect(retries).toEqual([1, 2]);
  });

  it("does not reset the retry budget for a duplicate-only replay stream", async () => {
    const calls: string[] = [];
    const event = { eventId: "event-1", cursor: "1", eventType: "created" };
    const client = { streamEvents: async function* (query: { projectId: string; after: string }) { calls.push(query.after); yield event; throw new Error("disconnected"); } };
    const received: string[] = [];
    for await (const item of subscribeToEvents({ client, projectId: "project-1", signal: new AbortController().signal, reconnectDelayMs: 0, maxReconnectAttempts: 2 })) received.push(item.eventId);
    expect(calls).toEqual(["0", "1", "1"]);
    expect(received).toEqual(["event-1"]);
  });

  it("reconnects from the latest cursor and suppresses duplicate event identities", async () => {
    const calls: string[] = [];
    let attempt = 0;
    const client = {
      streamEvents: async function* (query: { projectId: string; after: string }) {
        calls.push(query.after);
        attempt += 1;
        if (attempt === 1) {
          yield { eventId: "event-1", cursor: "1", eventType: "created" };
          throw new Error("disconnected");
        }
        yield { eventId: "event-1", cursor: "1", eventType: "created" };
        yield { eventId: "event-2", cursor: "2", eventType: "updated" };
      },
    };
    const controller = new AbortController();
    const events: string[] = [];
    for await (const event of subscribeToEvents({ client, projectId: "project-1", cursor: "0", signal: controller.signal, reconnectDelayMs: 0, maxReconnectAttempts: 1 })) {
      events.push(event.eventId);
      if (events.length === 2) controller.abort();
    }
    expect(calls).toEqual(["0", "1"]);
    expect(events).toEqual(["event-1", "event-2"]);
  });
});
