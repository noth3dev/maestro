import type { ApiClient } from "@maestro/api-client";
import { turnStatus, type ConversationEvent } from "@maestro/contracts";

export type GoalLessIntakeApi = Pick<
  ApiClient,
  "listModels" | "createConversation" | "getConversation" | "listConversationEvents" | "sendConversationTurn" | "cancelConversation"
>;

export type ConversationMessage = {
  id: string;
  role: "operator" | "concertmaster" | "system";
  content: string;
  createdAt: string;
};

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === "string" ? payload[key] : undefined;
}

function applyEvent(messages: Map<string, ConversationMessage>, event: ConversationEvent): void {
  const turnId = stringField(event.payload, "turnId");
  if (event.eventType === "turn_started") {
    const text = stringField(event.payload, "text");
    if (turnId !== undefined && text !== undefined) {
      messages.set(event.eventId, { id: event.eventId, role: "operator", content: text, createdAt: event.occurredAt });
    }
    return;
  }
  if (turnId === undefined) return;

  const existing = messages.get(turnId);
  if (event.eventType === "turn_delta") {
    const text = stringField(event.payload, "text") ?? "";
    messages.set(turnId, {
      id: turnId,
      role: "concertmaster",
      content: `${existing?.content ?? ""}${text}`,
      createdAt: existing?.createdAt ?? event.occurredAt,
    });
    return;
  }
  if (event.eventType === "turn_completed") {
    const content = stringField(event.payload, "content") ?? existing?.content ?? "";
    messages.set(turnId, { id: turnId, role: "concertmaster", content, createdAt: event.occurredAt });
    return;
  }
  if (event.eventType === "turn_failed" || event.eventType === "turn_cancelled" || event.eventType === "turn_unknown") {
    const content = stringField(event.payload, "message") ?? "Conversation turn outcome is unavailable";
    messages.set(turnId, { id: turnId, role: "system", content, createdAt: event.occurredAt });
  }
}

export async function loadConversation(
  api: GoalLessIntakeApi,
  input: { conversationId: string; projectId: string },
): Promise<ConversationMessage[]> {
  const conversation = await api.getConversation(input.conversationId, { projectId: input.projectId });
  if (conversation.conversationId !== input.conversationId || conversation.projectId !== input.projectId) {
    throw new Error("conversation boundary mismatch");
  }
  const events: ConversationEvent[] = [];
  let after = "0";
  while (true) {
    const page = await api.listConversationEvents(input.conversationId, { projectId: input.projectId, after });
    events.push(...page);
    if (page.length < 256) break;
    const next = page[page.length - 1]?.cursor;
    if (next === undefined || next === after) throw new Error("conversation event cursor did not advance");
    after = next;
  }
  const messages = new Map<string, ConversationMessage>();
  for (const event of events) {
    if (event.conversationId !== input.conversationId || event.projectId !== input.projectId) {
      throw new Error("event boundary mismatch");
    }
    applyEvent(messages, event);
  }
  return [...messages.values()];
}

export async function cancelHomeTurn(
  api: Pick<GoalLessIntakeApi, "cancelConversation">,
  input: { conversationId: string; projectId: string },
): Promise<{ status: ReturnType<typeof turnStatus>; error?: string }> {
  try {
    const conversation = await api.cancelConversation(input.conversationId, { projectId: input.projectId });
    return { status: turnStatus(conversation.status) };
  } catch (cause) {
    return { status: "unknown", error: cause instanceof Error ? cause.message : String(cause) };
  }
}
