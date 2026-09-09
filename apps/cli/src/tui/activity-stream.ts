import type { TranscriptLine } from "./theme.js";

export interface CursorEvent {
  cursor: string;
  eventId?: string;
}

function eventIdentity(event: CursorEvent): string { return event.eventId ?? event.cursor; }

export function mergeEvents<T extends CursorEvent>(existing: readonly T[], incoming: readonly T[]): T[] {
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
  onReconnect?: (attempt: number, maxAttempts: number) => void;
  onExhausted?: (error: unknown) => void;
}

function streamErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function streamErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isAuthorizationFailure(error: unknown): boolean {
  const status = streamErrorStatus(error);
  return status === 401 || status === 403;
}

export function describeStreamFailureLine(error: unknown): TranscriptLine {
  const status = streamErrorStatus(error);
  if (status === 401) return { kind: "error", text: `Activity stream authorization required: ${streamErrorMessage(error)}` };
  if (status === 403) return { kind: "error", text: `Activity stream authorization denied: ${streamErrorMessage(error)}` };
  return { kind: "error", text: `Activity stream unavailable: ${streamErrorMessage(error)}` };
}

export function describeStreamFailure(error: unknown): string {
  return describeStreamFailureLine(error).text;
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
  let lastError: unknown;
  const maxAttempts = options.maxReconnectAttempts ?? 5;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 0) throw new RangeError("maxReconnectAttempts must be a non-negative safe integer");
  const seen = new Set<string>();
  while (!options.signal.aborted) {
    try {
      for await (const event of options.client.streamEvents({ projectId: options.projectId, after: cursor }, { signal: options.signal })) {
        if (options.signal.aborted) return;
        cursor = event.cursor;
        const identity = eventIdentity(event);
        if (seen.has(identity)) continue;
        seen.add(identity);
        reconnectAttempts = 0;
        yield event;
      }
    } catch (error) {
      if (options.signal.aborted) return;
      lastError = error;
      if (isAuthorizationFailure(error)) throw error;
    }
    if (options.signal.aborted) return;
    reconnectAttempts += 1;
    if (reconnectAttempts > maxAttempts) {
      options.onExhausted?.(lastError);
      return;
    }
    options.onReconnect?.(reconnectAttempts, maxAttempts);
    await waitForReconnect(options.reconnectDelayMs ?? 250, options.signal);
  }
}


export interface ActivityStreamRunnerOptions<T extends CursorEvent> extends EventSubscriptionOptions<T> {
  onEvent: (event: T) => void | Promise<void>;
  onUnavailable?: (message: TranscriptLine) => void;
  onFailure?: (message: TranscriptLine) => void;
}

export async function runActivityStream<T extends CursorEvent>(options: ActivityStreamRunnerOptions<T>): Promise<void> {
  const { onEvent, onUnavailable, onFailure, ...subscription } = options;
  try {
    for await (const event of subscribeToEvents({
      ...subscription,
      onExhausted: (error) => onUnavailable?.(describeStreamFailureLine(error)),
    })) {
      if (options.signal.aborted) return;
      await onEvent(event);
    }
  } catch (error) {
    if (!options.signal.aborted) onFailure?.(describeStreamFailureLine(error));
  }
}
