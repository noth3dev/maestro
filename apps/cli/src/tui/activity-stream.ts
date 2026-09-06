export interface CursorEvent {
  cursor: string;
  eventId?: string;
}

function eventIdentity(event: CursorEvent): string { return event.eventId ?? event.cursor; }

export function mergeEvents<T extends CursorEvent>(existing: readonly T[], incoming: readonly T[]): T[] {
  const identities = new Set(existing.map(eventIdentity));
  return [...existing, ...incoming.filter((event) => !identities.has(eventIdentity(event)))];
}

export interface EventStreamClient<T extends CursorEvent> {
  streamEvents(query: { projectId: string; after: string }, options: { signal: AbortSignal }): AsyncIterable<T>;
}

export interface EventSubscriptionOptions<T extends CursorEvent> {
  client: EventStreamClient<T>;
  projectId: string;
  cursor?: string;
  signal: AbortSignal;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

function waitForReconnect(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export async function* subscribeToEvents<T extends CursorEvent>(options: EventSubscriptionOptions<T>): AsyncGenerator<T> {
  let cursor = options.cursor ?? "0";
  let reconnectAttempts = 0;
  const seen = new Set<string>();
  while (!options.signal.aborted && reconnectAttempts <= (options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY)) {
    try {
      for await (const event of options.client.streamEvents({ projectId: options.projectId, after: cursor }, { signal: options.signal })) {
        if (options.signal.aborted) return;
        cursor = event.cursor;
        const identity = eventIdentity(event);
        if (seen.has(identity)) continue;
        seen.add(identity);
        yield event;
      }
    } catch {
      if (options.signal.aborted) return;
    }
    if (options.signal.aborted) return;
    reconnectAttempts += 1;
    if (reconnectAttempts > (options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY)) return;
    await waitForReconnect(options.reconnectDelayMs ?? 250, options.signal);
  }
}
