import type { EventQuery, GoalEvent } from "@maestro/api-client";

export const EVENT_STREAM_CHANNELS = {
  start: "maestro:events:start",
  message: "maestro:events:message",
  stop: "maestro:events:stop",
} as const;

export type EventStreamMessage =
  | { kind: "event"; event: GoalEvent }
  | { kind: "end" }
  | { kind: "error"; message: string };

export type EventStreamSubscriber = (query: EventQuery, listener: (message: EventStreamMessage) => void) => () => void;
export type EventStreamSource = (query: EventQuery, options: { signal: AbortSignal }) => AsyncIterable<GoalEvent>;
export type EventStreamEmitter = (message: EventStreamMessage) => void;

function asError(message: string): Error {
  return new Error(message || "SSE stream failed");
}

/**
 * Adapts the clone-safe callback surface exposed by Electron preload into the
 * AsyncIterable consumed by useDurableEvents. Credentials remain in main.
 */
export function createRendererEventStream(
  subscribe: EventStreamSubscriber,
  query: EventQuery,
  signal?: AbortSignal,
): AsyncIterable<GoalEvent> {
  const queue: GoalEvent[] = [];
  const waiters: Array<{ resolve: (result: IteratorResult<GoalEvent>) => void; reject: (error: Error) => void }> = [];
  let subscribed = false;
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  let failure: Error | undefined;

  const cleanup = (): void => {
    unsubscribe?.();
    unsubscribe = undefined;
    signal?.removeEventListener("abort", onAbort);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    cleanup();
    while (waiters.length > 0) waiters.shift()?.resolve({ done: true, value: undefined });
  };

  const fail = (error: Error): void => {
    if (closed) return;
    failure = error;
    closed = true;
    cleanup();
    while (waiters.length > 0) waiters.shift()?.reject(error);
  };

  const onMessage = (message: EventStreamMessage): void => {
    if (message.kind === "event") {
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter.resolve({ done: false, value: message.event });
      else queue.push(message.event);
    } else if (message.kind === "end") {
      close();
    } else {
      fail(asError(message.message));
    }
  };

  const stop = (): void => close();
  const onAbort = (): void => stop();

  const next = (): Promise<IteratorResult<GoalEvent>> => {
    if (!subscribed) {
      subscribed = true;
      if (signal?.aborted) close();
      else {
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          unsubscribe = subscribe(query, onMessage);
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Unable to start SSE stream"));
        }
      }
    }
    if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() as GoalEvent });
    if (failure !== undefined) return Promise.reject(failure);
    if (closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };

  const iterator: AsyncIterator<GoalEvent> = {
    next,
    return: async () => { stop(); return { done: true, value: undefined }; },
  };
  return { [Symbol.asyncIterator]: () => iterator };
}

/** Pumps the existing API client's SSE iterator into Electron IPC messages. */
export async function pumpEventStream(
  source: EventStreamSource,
  query: EventQuery,
  signal: AbortSignal,
  emit: EventStreamEmitter,
): Promise<void> {
  try {
    for await (const event of source(query, { signal })) {
      if (signal.aborted) return;
      emit({ kind: "event", event });
    }
    if (!signal.aborted) emit({ kind: "end" });
  } catch (error) {
    if (!signal.aborted) emit({ kind: "error", message: error instanceof Error ? error.message : "SSE stream failed" });
  }
}
