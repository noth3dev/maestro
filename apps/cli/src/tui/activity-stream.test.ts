import { describe, expect, it } from "vitest";
import type { TranscriptLine } from "./theme.js";
import { describeStreamFailure, describeStreamFailureLine, mergeEvents, subscribeToEvents } from "./activity-stream.js";

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


describe("describeStreamFailureLine", () => {
  it("carries authorization and availability failures as error semantics", () => {
    const line: TranscriptLine = describeStreamFailureLine(Object.assign(new Error("Gateway unavailable"), { status: 503 }));

    expect(line).toEqual({ kind: "error", text: "Activity stream unavailable: Gateway unavailable" });
  });
});

describe("describeStreamFailure", () => {
  it("renders authorization failures as authorization failures", () => {
    expect(describeStreamFailure(Object.assign(new Error("Credential is not active"), { status: 403 })))
      .toBe("Activity stream authorization denied: Credential is not active");
    expect(describeStreamFailure(Object.assign(new Error("Authentication is required"), { status: 401 })))
      .toBe("Activity stream authorization required: Authentication is required");
  });

  it("renders gateway failures as explicit unavailable state", () => {
    expect(describeStreamFailure(Object.assign(new Error("Gateway unavailable"), { status: 503 })))
      .toBe("Activity stream unavailable: Gateway unavailable");
  });
});

describe("subscribeToEvents", () => {
  it("bounds failed reconnects and reports retry state", async () => {
    const calls: string[] = [];
    const retries: number[] = [];
    const offlineStream: AsyncIterable<never> = {
      [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error("offline"); } }),
    };
    const client = { streamEvents: (query: { projectId: string; after: string }, _options: { signal: AbortSignal }) => { calls.push(query.after); return offlineStream; } };
    for await (const event of subscribeToEvents({ client, projectId: "project-1", signal: new AbortController().signal, reconnectDelayMs: 0, maxReconnectAttempts: 2, onReconnect: (attempt) => retries.push(attempt) })) {
      void event;
    }
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

  it("surfaces authorization failures without retrying or inventing credentials", async () => {
    let calls = 0;
    const authorizationError = Object.assign(new Error("Credential is not active"), { status: 403 });
    const client = {
      streamEvents: (_query: { projectId: string; after: string }) => {
        calls += 1;
        return { [Symbol.asyncIterator]: () => ({ next: async () => { throw authorizationError; } }) };
      },
    };

    const consume = async () => {
      for await (const _event of subscribeToEvents({
        client,
        projectId: "project-1",
        signal: new AbortController().signal,
        reconnectDelayMs: 0,
        maxReconnectAttempts: 5,
      })) {
        // The authorization failure must terminate before yielding local state.
      }
    };

    await expect(consume()).rejects.toMatchObject({ status: 403, message: "Credential is not active" });
    expect(calls).toBe(1);
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
