import { describe, expect, it } from "vitest";
import { createDurableEventSubscription, type DurableEvent, type DurableEventsApi } from "./useDurableEvents.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const event = (eventId: string, cursor: string): DurableEvent => ({
  eventId,
  cursor,
  projectId,
  goalId: "22222222-2222-4222-8222-222222222222",
  aggregateVersion: cursor,
  eventType: "goal.updated",
  schemaVersion: 1,
  payload: {},
  occurredAt: "2026-01-01T00:00:00.000Z",
});

function apiFor(streamEvents: DurableEventsApi["streamEvents"], listEvents: DurableEventsApi["listEvents"] = async () => ({ events: [], nextCursor: "0" })): DurableEventsApi {
  return streamEvents === undefined ? { listEvents } : { streamEvents, listEvents };
}

describe("durable Secretary events", () => {
  it("reconnects from the latest cursor and emits no duplicate event", async () => {
    const calls: string[] = [];
    let connection = 0;
    const subscription = { stop: undefined as (() => void) | undefined };
    const states: Array<{ cursor: string; events: readonly DurableEvent[] }> = [];
    const api = apiFor(async function* (query) {
      calls.push(query.after);
      connection += 1;
      if (connection === 1) {
        yield event("event-1", "1");
        throw new Error("disconnected");
      }
      yield event("event-1", "1");
      yield event("event-2", "2");
    });

    const handle = createDurableEventSubscription({
      api,
      projectId,
      reconnectDelayMs: 0,
      maxReconnectAttempts: 1,
      maxPollingAttempts: 0,
      onState: (state) => {
        states.push({ cursor: state.cursor, events: state.events });
        if (state.cursor === "2") subscription.stop?.();
      },
    });
    subscription.stop = handle.stop;
    await handle.completed;

    expect(calls).toEqual(["0", "1"]);
    expect(states.at(-1)?.events.map((item) => item.eventId)).toEqual(["event-1", "event-2"]);
    expect(states.at(-1)?.cursor).toBe("2");
  });

  it("retains last-known events and marks the state stale when the stream fails", async () => {
    const states: Array<{ events: readonly DurableEvent[]; stale: boolean }> = [];
    const api = apiFor(
      async function* () {
        yield* [] as DurableEvent[];
        throw new Error("gateway unavailable");
      },
      async () => ({ events: [event("event-1", "1")], nextCursor: "1" }),
    );

    const handle = createDurableEventSubscription({
      api,
      projectId,
      reconnectDelayMs: 0,
      maxReconnectAttempts: 0,
      maxPollingAttempts: 0,
      onState: (state) => states.push({ events: state.events, stale: state.stale }),
    });
    await handle.completed;

    expect(states.at(-1)).toMatchObject({ stale: true, events: [event("event-1", "1")] });
  });

  it("falls back to bounded polling from the durable cursor without changing event truth", async () => {
    const streamCalls: string[] = [];
    const listCalls: string[] = [];
    const api = apiFor(
      async function* (query) {
        streamCalls.push(query.after);
        yield* [] as DurableEvent[];
        throw new Error("SSE unavailable");
      },
      async (query) => {
        listCalls.push(query.after);
        if (listCalls.length === 2) return { events: [event("event-1", "1")], nextCursor: "1" };
        return { events: [], nextCursor: listCalls.length === 1 ? "0" : "1" };
      },
    );
    const states: Array<{ transport: string; stale: boolean; events: readonly DurableEvent[] }> = [];

    const handle = createDurableEventSubscription({
      api,
      projectId,
      reconnectDelayMs: 0,
      pollIntervalMs: 0,
      maxReconnectAttempts: 0,
      maxPollingAttempts: 2,
      onState: (state) => states.push({ transport: state.transport, stale: state.stale, events: state.events }),
    });
    await handle.completed;

    expect(streamCalls).toEqual(["0"]);
    expect(listCalls).toEqual(["0", "0", "1"]);
    expect(states.some((state) => state.transport === "polling" && !state.stale && state.events[0]?.eventId === "event-1")).toBe(true);
  });

  it("hydrates from the control plane on every new subscription", async () => {
    let reads = 0;
    const api = apiFor(
      async function* () {
        yield* [] as DurableEvent[];
      },
      async () => {
        reads += 1;
        return { events: [event(`event-${reads}`, String(reads))], nextCursor: String(reads) };
      },
    );
    const first: DurableEvent[] = [];
    const second: DurableEvent[] = [];

    const firstHandle = createDurableEventSubscription({ api, projectId, maxReconnectAttempts: 0, maxPollingAttempts: 0, onState: (state) => first.push(...state.events) });
    await firstHandle.completed;
    const secondHandle = createDurableEventSubscription({ api, projectId, maxReconnectAttempts: 0, maxPollingAttempts: 0, onState: (state) => second.push(...state.events) });
    await secondHandle.completed;

    expect(reads).toBe(2);
    expect(first.at(-1)?.eventId).toBe("event-1");
    expect(second.at(-1)?.eventId).toBe("event-2");
  });
});
