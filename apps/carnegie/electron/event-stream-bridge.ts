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

export interface EventStreamIpcPort {
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
}

export type EventStreamSource = (query: EventQuery, options: { signal: AbortSignal }) => AsyncIterable<GoalEvent>;
export type EventStreamEmitter = (message: EventStreamMessage) => void;

function asError(message: string): Error {
  return new Error(message || "SSE stream failed");
}

/**
 * Adapts the dedicated Electron IPC stream into the AsyncIterable consumed by
 * useDurableEvents. The renderer receives only validated event data; credentials
 * stay in the main-process API client.
 */
export function createRendererEventStream(
  port: EventStreamIpcPort,
  query: EventQuery,
  makeStreamId: () => string = () => crypto.randomUUID(),
  signal?: AbortSignal,
): AsyncIterable<GoalEvent> {
  const streamId = makeStreamId();
  const queue: GoalEvent[] = [];
  const waiters: Array<{ resolve: (result: IteratorResult<GoalEvent>) => void; reject: (error: Error) => void }> = [];
  let started = false;
  let closed = false;
  let failure: Error | undefined;

  const remove = (): void => {
    port.removeListener(EVENT_STREAM_CHANNELS.message, onMessage);
    signal?.removeEventListener("abort", onAbort);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    remove();
    while (waiters.length > 0) waiters.shift()?.resolve({ done: true, value: undefined });
  };

  const fail = (error: Error): void => {
    if (closed) return;
    failure = error;
    closed = true;
    remove();
    while (waiters.length > 0) waiters.shift()?.reject(error);
  };

  const onMessage = (...args: unknown[]): void => {
    // ipcRenderer listeners receive (event, streamId, message); the small
    // two-argument form also keeps this adapter straightforward to unit test.
    const streamIdIndex = typeof args[0] === "string" ? 0 : 1;
    if (args[streamIdIndex] !== streamId) return;
    const message = args[streamIdIndex + 1] as EventStreamMessage | undefined;
    if (message?.kind === "event") {
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter.resolve({ done: false, value: message.event });
      else queue.push(message.event);
    } else if (message?.kind === "end") {
      close();
    } else if (message?.kind === "error") {
      fail(asError(message.message));
    }
  };

  const stop = (): void => {
    if (closed) return;
    if (started) port.send(EVENT_STREAM_CHANNELS.stop, streamId);
    close();
  };

  const onAbort = (): void => stop();

  const next = (): Promise<IteratorResult<GoalEvent>> => {
    if (!started) {
      started = true;
      port.on(EVENT_STREAM_CHANNELS.message, onMessage);
      if (signal?.aborted) stop();
      else {
        signal?.addEventListener("abort", onAbort, { once: true });
        port.send(EVENT_STREAM_CHANNELS.start, streamId, query);
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
