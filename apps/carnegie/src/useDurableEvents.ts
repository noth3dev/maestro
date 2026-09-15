import { useEffect, useState } from "react";
import type { ApiClient, GoalEvent } from "@maestro/api-client";

export type DurableEvent = GoalEvent;
export type DurableEventsApi = Pick<ApiClient, "listEvents"> & Partial<Pick<ApiClient, "streamEvents">>;

export type DurableEventTransport = "connecting" | "sse" | "polling";
export interface DurableEventState {
  events: readonly DurableEvent[];
  cursor: string;
  stale: boolean;
  transport: DurableEventTransport;
  error: string | undefined;
}

export interface DurableEventSubscriptionOptions {
  api: DurableEventsApi;
  projectId: string;
  cursor?: string;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
  pollIntervalMs?: number;
  maxPollingAttempts?: number;
  /** Number of polling requests between SSE reconnect attempts. Defaults to 5 for the unbounded production fallback. */
  pollingSseRetryAttempts?: number;
  onState: (state: DurableEventState) => void;
}

export interface DurableEventSubscriptionHandle {
  stop: () => void;
  completed: Promise<void>;
}

function eventIdentity(event: DurableEvent): string {
  return event.eventId || event.cursor;
}

export function mergeDurableEvents(existing: readonly DurableEvent[], incoming: readonly DurableEvent[]): DurableEvent[] {
  const identities = new Set(existing.map(eventIdentity));
  const merged = [...existing];
  for (const event of incoming) {
    const identity = eventIdentity(event);
    if (identities.has(identity)) continue;
    identities.add(identity);
    merged.push(event);
  }
  return merged;
}

function maxCursor(left: string, right: string): string {
  try { return BigInt(right) > BigInt(left) ? right : left; } catch { return right; }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function waitFor(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function safeCount(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function createDurableEventSubscription(options: DurableEventSubscriptionOptions): DurableEventSubscriptionHandle {
  const controller = new AbortController();
  const reconnectDelayMs = options.reconnectDelayMs ?? 250;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const maxReconnectAttempts = safeCount(options.maxReconnectAttempts, 5);
  // Polling stays at a bounded interval until the subscription is stopped. Tests may cap attempts.
  const maxPollingAttempts = options.maxPollingAttempts === undefined ? Number.POSITIVE_INFINITY : safeCount(options.maxPollingAttempts, 0);
  const retrySseAfterPolling = options.pollingSseRetryAttempts !== undefined || maxPollingAttempts === Number.POSITIVE_INFINITY;
  const pollingSseRetryAttempts = safeCount(options.pollingSseRetryAttempts, 5);
  const pollingAttemptLimit = retrySseAfterPolling ? Math.min(maxPollingAttempts, pollingSseRetryAttempts) : maxPollingAttempts;
  let state: DurableEventState = { events: [], cursor: options.cursor ?? "0", stale: false, transport: "connecting", error: undefined };

  const publish = (patch: Partial<DurableEventState>): void => {
    if (controller.signal.aborted) return;
    state = { ...state, ...patch };
    options.onState(state);
  };

  const append = (incoming: readonly DurableEvent[]): void => {
    let cursor = state.cursor;
    for (const event of incoming) cursor = maxCursor(cursor, event.cursor);
    publish({ events: mergeDurableEvents(state.events, incoming), cursor });
  };

  const hydrate = async (): Promise<void> => {
    let cursor = state.cursor;
    while (!controller.signal.aborted) {
      const page = await options.api.listEvents({ projectId: options.projectId, after: cursor });
      const previousCursor = cursor;
      append(page.events);
      const nextCursor = maxCursor(previousCursor, page.nextCursor);
      cursor = nextCursor;
      publish({ cursor });
      if (page.events.length === 0 || page.events.length < 100 || nextCursor === previousCursor) return;
    }
  };

  const poll = async (allowSseRetry = retrySseAfterPolling): Promise<boolean> => {
    const attemptLimit = allowSseRetry ? pollingAttemptLimit : maxPollingAttempts;
    if (attemptLimit === 0) return false;
    publish({ transport: "polling", stale: true });
    for (let attempt = 0; attempt < attemptLimit && !controller.signal.aborted; attempt += 1) {
      try {
        const page = await options.api.listEvents({ projectId: options.projectId, after: state.cursor });
        append(page.events);
        const cursor = maxCursor(state.cursor, page.nextCursor);
        publish({ transport: "polling", cursor, stale: false, error: undefined });
      } catch (error) {
        publish({ transport: "polling", stale: true, error: errorMessage(error) });
      }
      if (attempt + 1 < attemptLimit) await waitFor(pollIntervalMs, controller.signal);
    }
    if (controller.signal.aborted) return false;
    publish({ stale: true });
    return allowSseRetry && retrySseAfterPolling;
  };

  const run = async (): Promise<void> => {
    try {
      try {
        await hydrate();
        if (!controller.signal.aborted) publish({ transport: "sse", stale: false, error: undefined });
      } catch (error) {
        if (!controller.signal.aborted) publish({ stale: true, error: errorMessage(error) });
      }

      if (options.api.streamEvents === undefined) {
        if (!controller.signal.aborted) await poll(false);
        return;
      }

      let reconnectAttempts = 0;
      while (!controller.signal.aborted) {
        // A healthy reopened stream may be idle; publish the handback before awaiting its first event.
        publish({ transport: "sse", stale: false, error: undefined });
        try {
          for await (const event of options.api.streamEvents({ projectId: options.projectId, after: state.cursor }, { signal: controller.signal })) {
            if (controller.signal.aborted) return;
            append([event]);
            publish({ transport: "sse", stale: false, error: undefined });
            reconnectAttempts = 0;
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          publish({ stale: true, error: errorMessage(error) });
        }
        if (controller.signal.aborted) return;
        reconnectAttempts += 1;
        if (reconnectAttempts <= maxReconnectAttempts) {
          await waitFor(reconnectDelayMs, controller.signal);
          continue;
        }
        if (!(await poll())) return;
        reconnectAttempts = 0;
      }
    } catch (error) {
      if (!controller.signal.aborted) publish({ stale: true, error: errorMessage(error) });
    }
  };

  const completed = run();
  return { stop: () => controller.abort(), completed };
}

export function useDurableEvents(api: DurableEventsApi, projectId: string, options: Omit<DurableEventSubscriptionOptions, "api" | "projectId" | "onState"> = {}): DurableEventState {
  const [state, setState] = useState<DurableEventState>({ events: [], cursor: options.cursor ?? "0", stale: false, transport: "connecting", error: undefined });
  const { cursor, reconnectDelayMs, maxReconnectAttempts, pollIntervalMs, maxPollingAttempts, pollingSseRetryAttempts } = options;

  useEffect(() => {
    setState({ events: [], cursor: cursor ?? "0", stale: false, transport: "connecting", error: undefined });
    const handle = createDurableEventSubscription({
      api,
      projectId,
      ...(cursor === undefined ? {} : { cursor }),
      ...(reconnectDelayMs === undefined ? {} : { reconnectDelayMs }),
      ...(maxReconnectAttempts === undefined ? {} : { maxReconnectAttempts }),
      ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
      ...(maxPollingAttempts === undefined ? {} : { maxPollingAttempts }),
      ...(pollingSseRetryAttempts === undefined ? {} : { pollingSseRetryAttempts }),
      onState: setState,
    });
    return () => handle.stop();
  }, [api, projectId, cursor, reconnectDelayMs, maxReconnectAttempts, pollIntervalMs, maxPollingAttempts, pollingSseRetryAttempts]);

  return state;
}
