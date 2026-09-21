import {
  GoalQuerySchema,
  ConversationEventQuerySchema,
  ConversationEventSchema,
  ConversationActivityEventSchema,
  EventQuerySchema,
  GoalEventSchema,
  StableApiErrorSchema,
  type GoalQuery,
  type ConversationEvent,
  type ConversationActivityEvent,
  type ConversationEventQuery,
  type EventQuery,
  type GoalEvent,
} from "@maestro/contracts";
import { ApiError } from "./errors.js";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function cryptoRandomUuid(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  throw new Error("Secure random UUID generation is unavailable");
}

export async function* readEventStream(
  fetch: Fetch,
  base: URL,
  headers: Record<string, string>,
  query: EventQuery,
  signal?: AbortSignal,
  onConnected?: () => void,
): AsyncGenerator<GoalEvent> {
  const parsed = EventQuerySchema.parse(query);
  const url = new URL("v1/events/stream", base);
  url.search = new URLSearchParams({ projectId: parsed.projectId, after: parsed.after }).toString();
  let response: Response;
  try {
    response = await fetch(url.href, {
      headers: { ...headers, "last-event-id": parsed.after },
      redirect: "error",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    throw new Error("Control plane event stream failed");
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const stable = StableApiErrorSchema.safeParse(body);
    if (stable.success) throw new ApiError(response.status, stable.data.error.code, stable.data.error.message, stable.data.error.detail);
    throw new Error(`Control plane event stream returned HTTP ${response.status}`);
  }
  if (response.body === null) throw new Error("Control plane event stream returned no body");
  onConnected?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const records = buffer.split(/\r?\n\r?\n/);
      buffer = records.pop() ?? "";
      for (const record of records) {
        const eventName = record.match(/^event:\s*(.+)$/m)?.[1];
        const data = record.match(/^data:\s*(.+)$/m)?.[1];
        if (eventName !== "goal-event" || data === undefined) continue;
        yield GoalEventSchema.parse(JSON.parse(data));
      }
      if (chunk.done) break;
    }
    if (buffer.trim() !== "") {
      const eventName = buffer.match(/^event:\s*(.+)$/m)?.[1];
      const data = buffer.match(/^data:\s*(.+)$/m)?.[1];
      if (eventName === "goal-event" && data !== undefined) yield GoalEventSchema.parse(JSON.parse(data));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const MAX_CONVERSATION_STREAM_RECORD_BYTES = 128_000;

export async function* readConversationEventStream(
  fetch: Fetch,
  base: URL,
  headers: Record<string, string>,
  conversationId: string,
  query: ConversationEventQuery,
  signal?: AbortSignal,
): AsyncGenerator<ConversationEvent> {
  const parsed = ConversationEventQuerySchema.parse(query);
  const url = new URL(`v1/conversations/${encodeURIComponent(conversationId)}/events/stream`, base);
  url.search = new URLSearchParams({ projectId: parsed.projectId, after: parsed.after }).toString();
  let response: Response;
  try {
    response = await fetch(url.href, {
      headers: { ...headers, "last-event-id": parsed.after },
      redirect: "error",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    throw new Error("Control plane conversation stream failed");
  }
  if (!response.ok) throw new Error(`Control plane conversation stream returned HTTP ${response.status}`);
  if (response.body === null) throw new Error("Control plane conversation stream returned no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const records = buffer.split(/\r?\n\r?\n/);
      buffer = records.pop() ?? "";
      if (Buffer.byteLength(buffer, "utf8") > MAX_CONVERSATION_STREAM_RECORD_BYTES)
        throw new Error("Control plane conversation stream record is too large");
      for (const record of records) {
        if (Buffer.byteLength(record, "utf8") > MAX_CONVERSATION_STREAM_RECORD_BYTES)
          throw new Error("Control plane conversation stream record is too large");
        if (record.match(/^event:\s*(.+)$/m)?.[1] !== "conversation-event") continue;
        const data = record.match(/^data:\s*(.+)$/m)?.[1];
        if (data !== undefined) yield ConversationEventSchema.parse(JSON.parse(data));
      }
      if (chunk.done) break;
    }
    if (buffer.trim() !== "") {
      if (Buffer.byteLength(buffer, "utf8") > MAX_CONVERSATION_STREAM_RECORD_BYTES)
        throw new Error("Control plane conversation stream record is too large");
      if (buffer.match(/^event:\s*(.+)$/m)?.[1] === "conversation-event") {
        const data = buffer.match(/^data:\s*(.+)$/m)?.[1];
        if (data !== undefined) yield ConversationEventSchema.parse(JSON.parse(data));
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function* readConversationActivityStream(
  fetch: Fetch,
  base: URL,
  headers: Record<string, string>,
  conversationId: string,
  query: GoalQuery,
  signal?: AbortSignal,
  onConnected?: () => void,
): AsyncGenerator<ConversationActivityEvent> {
  const parsed = GoalQuerySchema.parse(query);
  const url = new URL(`v1/conversations/${encodeURIComponent(conversationId)}/activity/stream`, base);
  url.search = new URLSearchParams({ projectId: parsed.projectId }).toString();
  let response: Response;
  try {
    response = await fetch(url.href, { headers, redirect: "error", ...(signal === undefined ? {} : { signal }) });
  } catch {
    throw new Error("Control plane conversation activity stream failed");
  }
  if (!response.ok) throw new Error(`Control plane conversation activity stream returned HTTP ${response.status}`);
  if (response.body === null) throw new Error("Control plane conversation activity stream returned no body");
  const reader = response.body.getReader();
  onConnected?.();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const records = buffer.split(/\r?\n\r?\n/);
      buffer = records.pop() ?? "";
      if (Buffer.byteLength(buffer, "utf8") > MAX_CONVERSATION_STREAM_RECORD_BYTES)
        throw new Error("Control plane conversation activity stream record is too large");
      for (const record of records) {
        if (Buffer.byteLength(record, "utf8") > MAX_CONVERSATION_STREAM_RECORD_BYTES)
          throw new Error("Control plane conversation activity stream record is too large");
        if (record.match(/^event:\s*(.+)$/m)?.[1] !== "conversation-activity") continue;
        const data = record.match(/^data:\s*(.+)$/m)?.[1];
        if (data !== undefined) yield ConversationActivityEventSchema.parse(JSON.parse(data));
      }
      if (chunk.done) break;
    }
    if (buffer.trim() !== "" && buffer.match(/^event:\s*(.+)$/m)?.[1] === "conversation-activity") {
      const data = buffer.match(/^data:\s*(.+)$/m)?.[1];
      if (data !== undefined) yield ConversationActivityEventSchema.parse(JSON.parse(data));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
