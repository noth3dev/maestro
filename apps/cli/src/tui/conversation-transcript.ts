import type { ConversationEvent } from "@maestro/contracts";

export type ConversationTurnStatus = "idle" | "streaming" | "succeeded" | "failed" | "cancelled" | "unknown";
export type ConversationTranscriptMessage = { role: "user" | "assistant" | "system"; content: string };

export type ConversationTranscriptState = {
  messages: ConversationTranscriptMessage[];
  activeTurnId: string | undefined;
  assistantText: string;
  status: ConversationTurnStatus;
  statusMessage: string | undefined;
  lastCursor: string;
};

export function createConversationTranscript(): ConversationTranscriptState {
  return { messages: [], activeTurnId: undefined, assistantText: "", status: "idle", statusMessage: undefined, lastCursor: "0" };
}

export function addConversationMessage(
  state: ConversationTranscriptState,
  role: "user" | "system",
  content: string,
): ConversationTranscriptState {
  if (content.trim() === "") return state;
  return { ...state, messages: [...state.messages, { role, content }] };
}

function payloadText(event: ConversationEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sameOrNewerCursor(cursor: string, lastCursor: string): boolean {
  try {
    return BigInt(cursor) > BigInt(lastCursor);
  } catch {
    return false;
  }
}

export function applyConversationEvent(
  state: ConversationTranscriptState,
  event: ConversationEvent,
): ConversationTranscriptState {
  if (!sameOrNewerCursor(event.cursor, state.lastCursor)) return state;
  const next: ConversationTranscriptState = { ...state, lastCursor: event.cursor };
  const turnId = payloadText(event, "turnId");
  if (event.eventType === "turn_started") {
    const userText = payloadText(event, "text");
    const previousAssistant = next.assistantText !== "" ? [{ role: "assistant" as const, content: next.assistantText }] : [];
    const lastUser = [...next.messages].reverse().find((message) => message.role === "user");
    const withAssistant = [...next.messages, ...previousAssistant];
    const messages = userText !== undefined && lastUser?.content !== userText
      ? [...withAssistant, { role: "user" as const, content: userText }]
      : withAssistant;
    return { ...next, messages, activeTurnId: turnId, assistantText: "", status: "streaming", statusMessage: undefined };
  }
  if (turnId !== undefined && next.activeTurnId !== undefined && turnId !== next.activeTurnId) return next;
  if (event.eventType === "turn_delta") {
    const text = payloadText(event, "text");
    return text === undefined ? next : { ...next, activeTurnId: turnId ?? next.activeTurnId, assistantText: next.assistantText + text, status: "streaming" };
  }
  if (event.eventType === "turn_completed") {
    const content = payloadText(event, "content");
    return { ...next, activeTurnId: turnId ?? next.activeTurnId, assistantText: next.assistantText || content || "", status: "succeeded", statusMessage: undefined };
  }
  if (event.eventType === "turn_failed") {
    return { ...next, activeTurnId: turnId ?? next.activeTurnId, status: "failed", statusMessage: payloadText(event, "message") };
  }
  if (event.eventType === "turn_cancelled") {
    return { ...next, activeTurnId: turnId ?? next.activeTurnId, status: "cancelled", statusMessage: payloadText(event, "message") };
  }
  if (event.eventType === "turn_unknown") {
    return { ...next, activeTurnId: turnId ?? next.activeTurnId, status: "unknown", statusMessage: payloadText(event, "message") };
  }
  return next;
}

function messageHeading(role: ConversationTranscriptMessage["role"]): string {
  return role === "user" ? "**You**" : role === "system" ? "**System**" : "**Maestro**";
}

export function renderConversationMarkdown(state: ConversationTranscriptState): string {
  const sections = state.messages.map((message) => `${messageHeading(message.role)}\n\n${message.content}`);
  if (state.assistantText !== "" || state.status !== "idle") {
    const suffix = state.status === "streaming" ? " _(streaming…)" : state.status === "idle" ? "" : ` _(${state.status})_`;
    const content = state.assistantText || state.statusMessage || (state.status === "streaming" ? "_Waiting for response…_" : "");
    sections.push(`**Maestro**${suffix}\n\n${content}`);
  }
  return sections.join("\n\n");
}
