import type { Conversation, ConversationActivityEvent, ConversationEvent } from "@maestro/contracts";
import { UuidSchema } from "@maestro/contracts";
import { formatModelRef, type GatewayBinding } from "@maestro/agent-runtime";

export class ConversationNotFoundError extends Error {}
export class ConversationConflictError extends Error {}
export class ConversationUnavailableError extends Error {}
export class ConversationModelNotAllowedError extends Error {}

export type ConversationRow = {
  conversation_id: string;
  operator_id: string;
  project_id: string;
  goal_id: string | null;
  model_provider: string;
  model_id: string;
  status: Conversation["status"];
  version: number;
  binding: GatewayBinding;
  active_turn_id: string | null;
  active_request_id: string | null;
  create_request_id: string | null;
};

export const MAX_TEXT = 64_000;
export const MAX_PERSISTED_TEXT_BYTES = 60_000;
export const SECRET_LIKE =
  /(bearer\s+[\w./+=-]{12,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|private[_-]?key)\s*[:=]|-----begin .*private key-----|(?:^|[^a-z0-9])sk-[a-z0-9_-]{16,})/i;
export function boundedText(text: string, maxBytes = MAX_PERSISTED_TEXT_BYTES): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) end -= 1;
  if (end < text.length && end > 0) {
    const previous = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  }
  return text.slice(0, end);
}
export function assertSafeText(text: string): void {
  if (text.length > MAX_TEXT || Buffer.byteLength(text, "utf8") > MAX_PERSISTED_TEXT_BYTES || SECRET_LIKE.test(text))
    throw new ConversationConflictError("conversation text is invalid or contains credential-like data");
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (
      code === 0 ||
      (code >= 0xd800 &&
        code <= 0xdbff &&
        (index + 1 >= text.length || text.charCodeAt(index + 1) < 0xdc00 || text.charCodeAt(index + 1) > 0xdfff)) ||
      (code >= 0xdc00 && code <= 0xdfff && (index === 0 || text.charCodeAt(index - 1) < 0xd800 || text.charCodeAt(index - 1) > 0xdbff))
    )
      throw new ConversationConflictError("conversation text contains invalid Unicode");
  }
}
export function modelFromRow(row: ConversationRow): Conversation {
  return {
    conversationId: UuidSchema.parse(row.conversation_id),
    projectId: UuidSchema.parse(row.project_id),
    goalId: row.goal_id === null ? null : UuidSchema.parse(row.goal_id),
    model: formatModelRef({ provider: row.model_provider, id: row.model_id }),
    status: row.status,
    version: row.version,
  };
}
export function statusFromObservation(status: string): Conversation["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "unknown") return "unknown";
  return "running";
}
export function terminalEventType(status: Conversation["status"]): ConversationEvent["eventType"] {
  return status === "succeeded"
    ? "turn_completed"
    : status === "cancelled"
      ? "turn_cancelled"
      : status === "unknown"
        ? "turn_unknown"
        : "turn_failed";
}
export function turnStatus(status: Conversation["status"]): "completed" | "failed" | "cancelled" | "unknown" {
  return status === "succeeded" ? "completed" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "unknown";
}
export function cancellationContent(status: Conversation["status"]): string {
  return status === "cancelled" ? "Conversation turn cancelled" : "Conversation turn outcome is unavailable";
}
export function now(): string {
  return new Date().toISOString();
}

export function safeActivityToolName(name: string): string {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(name) ? name : "tool";
}

export function modelActivity(
  event: import("@maestro/agent-runtime").ModelStreamEvent,
): { phase: ConversationActivityEvent["phase"]; toolName?: string; status?: ConversationActivityEvent["status"] } | undefined {
  switch (event.kind) {
    case "thinking-delta":
      return { phase: "thinking" };
    case "text-delta":
      return event.text === "" ? undefined : { phase: "writing" };
    case "tool-proposed":
      return { phase: "tool-call", toolName: safeActivityToolName(event.call.name), status: "proposed" };
    case "tool-validated":
      return { phase: "tool-call", toolName: safeActivityToolName(event.toolName), status: "validated" };
    case "tool-executing":
      return { phase: "executing", toolName: safeActivityToolName(event.toolName), status: "executing" };
    case "tool-completed":
      return { phase: "tool-result", toolName: safeActivityToolName(event.toolName), status: event.status };
    case "tool-rejected":
      return { phase: "error", toolName: safeActivityToolName(event.toolName), status: "error" };
    case "provider-error":
      return { phase: "error" };
    case "terminal":
      return event.status === "failed" || event.status === "unknown"
        ? { phase: "error", status: event.status === "failed" ? "error" : "unknown" }
        : { phase: "waiting", ...(event.status === "cancelled" ? { status: "cancelled" } : {}) };
    case "usage":
      return undefined;
  }
}
