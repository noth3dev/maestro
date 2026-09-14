import type { ConversationEvent, GoalEvent } from "@maestro/contracts";
import { renderActivityTimeline, toActivityTimelineEvent } from "./components/activity-timeline.js";
import { fitPlain, type TranscriptKind } from "./theme.js";

export type ConversationTurnStatus = "idle" | "streaming" | "succeeded" | "failed" | "cancelled" | "unknown";
export type ConversationTranscriptMessage = { role: "user" | "assistant" | "system"; content: string; kind: TranscriptKind; cursor?: string };
export type ConversationManualMessage = { message: ConversationTranscriptMessage; occurredAt: string; sequence: number };

export type ConversationTranscriptState = {
  messages: ConversationTranscriptMessage[];
  manualMessages: ConversationManualMessage[];
  events: ConversationEvent[];
  activeTurnId: string | undefined;
  assistantText: string;
  status: ConversationTurnStatus;
  statusMessage: string | undefined;
  lastCursor: string;
};

export function createConversationTranscript(): ConversationTranscriptState {
  return { messages: [], manualMessages: [], events: [], activeTurnId: undefined, assistantText: "", status: "idle", statusMessage: undefined, lastCursor: "0" };
}

export function addConversationMessage(
  state: ConversationTranscriptState,
  role: "user" | "system",
  content: string,
  kind: TranscriptKind = role === "system" ? "system" : "text",
): ConversationTranscriptState {
  if (content.trim() === "") return state;
  const message = { role, content, kind } as const;
  const manualMessage: ConversationManualMessage = { message, occurredAt: new Date().toISOString(), sequence: state.manualMessages.length };
  return { ...state, messages: [...state.messages, message], manualMessages: [...state.manualMessages, manualMessage] };
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

const TERMINAL_CONVERSATION_EVENTS = new Set(["turn_completed", "turn_failed", "turn_cancelled", "turn_unknown"]);

/** Accept terminal state only when it belongs to the active turn and has a usable result. */
export function isTerminalConversationEvent(state: ConversationTranscriptState, event: ConversationEvent): boolean {
  if (!TERMINAL_CONVERSATION_EVENTS.has(event.eventType)) return false;
  const turnId = payloadText(event, "turnId");
  if (turnId === undefined || state.activeTurnId === undefined || turnId !== state.activeTurnId) return false;
  if (event.eventType === "turn_completed" && state.assistantText === "" && payloadText(event, "content") === undefined) return false;
  return true;
}

export function applyConversationEvent(
  state: ConversationTranscriptState,
  event: ConversationEvent,
): ConversationTranscriptState {
  if (!sameOrNewerCursor(event.cursor, state.lastCursor)) return state;
  const next: ConversationTranscriptState = { ...state, events: [...state.events, event].slice(-512), lastCursor: event.cursor };
  if (TERMINAL_CONVERSATION_EVENTS.has(event.eventType) && !isTerminalConversationEvent(state, event)) return next;
  const turnId = payloadText(event, "turnId");
  if (event.eventType === "turn_started") {
    const userText = payloadText(event, "text");
    const previousAssistant = next.assistantText !== "" ? [{ role: "assistant" as const, content: next.assistantText, kind: "text" as const, cursor: state.lastCursor }] : [];
    const lastUser = [...next.messages].reverse().find((message) => message.role === "user");
    const withAssistant = [...next.messages, ...previousAssistant];
    const messages = userText !== undefined && lastUser?.content !== userText
      ? [...withAssistant, { role: "user" as const, content: userText, kind: "text" as const, cursor: event.cursor }]
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

export type ConversationTranscriptBlock = {
  heading: string;
  content: string;
  kind: TranscriptKind;
};

export function renderConversationBlocks(state: ConversationTranscriptState): ConversationTranscriptBlock[] {
  const blocks = state.messages.map((message) => ({
    heading: messageHeading(message.role),
    content: message.content,
    kind: message.kind,
  }));
  if (state.assistantText !== "" || state.status !== "idle") {
    const suffix = state.status === "streaming" ? " _(streaming…)" : state.status === "idle" ? "" : ` _(${state.status})_`;
    const content = state.assistantText || state.statusMessage || (state.status === "streaming" ? "_Waiting for response…_" : "");
    const kind: TranscriptKind = state.status === "failed" ? "error" : state.status === "succeeded" ? "success" : state.status === "idle" || state.status === "streaming" ? "text" : "warning";
    blocks.push({ heading: `**Maestro**${suffix}`, content, kind });
  }
  return blocks;
}

export function renderConversationMarkdown(state: ConversationTranscriptState): string {
  return renderConversationBlocks(state)
    .map((block) => `${block.heading}\n\n${block.content}`)
    .join("\n\n");
}


export type UnifiedStreamEntry = {
  readonly occurredAt: string;
  readonly stable: string;
  readonly content: ConversationTranscriptBlock | string;
};

function conversationEventBlock(event: ConversationEvent, aggregate?: string): ConversationTranscriptBlock | undefined {
  const text = payloadText(event, "text");
  const content = payloadText(event, "content") ?? aggregate;
  const message = payloadText(event, "message");
  if (event.eventType === "turn_started") return { heading: "**You**", content: text ?? "", kind: "text" };
  if (event.eventType === "turn_delta") return { heading: "**Maestro**", content: aggregate ?? text ?? "", kind: "text" };
  if (event.eventType === "turn_completed") return { heading: "**Maestro**", content: content ?? "", kind: "success" };
  if (event.eventType === "turn_failed") return { heading: "**Maestro**", content: message ?? "turn failed", kind: "error" };
  if (event.eventType === "turn_cancelled") return { heading: "**Maestro**", content: message ?? "cancelled", kind: "warning" };
  if (event.eventType === "turn_unknown") return { heading: "**Maestro**", content: message ?? "unknown outcome", kind: "warning" };
  return undefined;
}

function conversationStreamEntries(state: ConversationTranscriptState): UnifiedStreamEntry[] {
  const completedTurns = new Set<string>();
  const deltaText = new Map<string, string>();
  const lastDelta = new Map<string, ConversationEvent>();
  for (const event of state.events) {
    const turnId = payloadText(event, "turnId");
    if (["turn_completed", "turn_failed", "turn_cancelled", "turn_unknown"].includes(event.eventType) && turnId !== undefined) completedTurns.add(turnId);
    if (event.eventType === "turn_delta" && turnId !== undefined) {
      deltaText.set(turnId, `${deltaText.get(turnId) ?? ""}${payloadText(event, "text") ?? ""}`);
      lastDelta.set(turnId, event);
    }
  }
  return state.events.flatMap((event) => {
    const turnId = payloadText(event, "turnId");
    if (event.eventType === "turn_delta") {
      if (turnId === undefined || completedTurns.has(turnId) || lastDelta.get(turnId) !== event) return [];
      const block = conversationEventBlock(event, deltaText.get(turnId));
      return block === undefined ? [] : [{ occurredAt: event.occurredAt ?? "", stable: `conversation:${event.eventId}:${event.cursor}`, content: block }];
    }
    const block = conversationEventBlock(event, turnId === undefined ? undefined : deltaText.get(turnId));
    return block === undefined ? [] : [{ occurredAt: event.occurredAt ?? "", stable: `conversation:${event.eventId}:${event.cursor}`, content: block }];
  });
}

/** Render conversation and Goal events as ordered entries for the active viewport. */
export function renderUnifiedStreamEntries(state: ConversationTranscriptState, activity: readonly GoalEvent[], width: number): UnifiedStreamEntry[] {
  const turnTexts = new Set(state.events.filter((event) => event.eventType === "turn_started").map((event) => payloadText(event, "text")).filter((text): text is string => text !== undefined));
  const entries: UnifiedStreamEntry[] = [
    ...state.manualMessages
      .filter((item) => !(item.message.role === "user" && turnTexts.has(item.message.content)))
      .map((item) => ({
        occurredAt: item.occurredAt,
        stable: `manual:${item.sequence}`,
        content: {
          heading: item.message.role === "user" ? "**You**" : item.message.role === "system" ? "**System**" : "**Maestro**",
          content: item.message.content,
          kind: item.message.kind,
        },
      })),
    ...conversationStreamEntries(state),
    ...activity.map((event) => {
      const timelineEvent = toActivityTimelineEvent(event);
      return { occurredAt: event.occurredAt ?? "", stable: `activity:${event.eventId}:${event.cursor}`, content: renderActivityTimeline([timelineEvent], width).join("\n") };
    }),
  ];
  entries.sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    if (left.occurredAt !== right.occurredAt) return left.occurredAt.localeCompare(right.occurredAt);
    return left.stable.localeCompare(right.stable);
  });
  return entries;
}

/** Render ordered stream entries as plain lines for compatibility and terminal assertions. */
export function renderUnifiedStream(state: ConversationTranscriptState, activity: readonly GoalEvent[], width: number): string[] {
  return renderUnifiedStreamEntries(state, activity, width).flatMap((entry) => {
    if (typeof entry.content === "string") return entry.content.split("\n");
    const glyph = entry.content.kind === "error" ? "✗ " : entry.content.kind === "success" ? "✓ " : entry.content.kind === "warning" ? "⚠ " : entry.content.kind === "system" ? "◆ " : "";
    return [fitPlain(`${glyph}${entry.content.heading.replaceAll("**", "")}  ${entry.content.content}`, width)];
  });
}
