import type { OvertureEvent, OvertureMessage } from "@maestro/contracts";
import type { ConversationMessage } from "./conversation-data.js";

export type TimelineAuthor = "operator" | "concertmaster" | "overture" | "activity" | "system";

export type TimelineItem = {
  id: string;
  author: TimelineAuthor;
  /** Overture crew role for `overture` items, e.g. `conversation-lead`. */
  role?: string;
  content: string;
  createdAt: string;
  /** Optimistic operator text or an in-flight reply placeholder. */
  pending?: boolean;
};

/** Crew tool use (Python cells and workspace file helpers) as compact activity lines. */
export function projectToolActivity(events: readonly OvertureEvent[]): TimelineItem[] {
  return events
    .filter((event) => event.eventType === "tool_activity")
    .map((event) => {
      const payload = event.payload as { roleId?: unknown; kind?: unknown; status?: unknown; path?: unknown; detail?: unknown };
      const path = typeof payload.path === "string" ? payload.path : undefined;
      const detail = typeof payload.detail === "string" && payload.detail !== "" ? payload.detail : undefined;
      const failed = payload.status === "error";
      const action =
        payload.kind === "write_file"
          ? `wrote ${path ?? "a file"}${detail !== undefined && !failed ? ` (${detail})` : ""}`
          : payload.kind === "read_file"
            ? `read ${path ?? "a file"}`
            : payload.kind === "list_files"
              ? "listed workspace files"
              : `ran Python${detail !== undefined && !failed ? `: ${detail}` : ""}`;
      return {
        id: event.eventId,
        author: "activity" as const,
        ...(typeof payload.roleId === "string" ? { role: payload.roleId } : {}),
        content: failed ? `${action} — failed${detail !== undefined ? `: ${detail}` : ""}` : action,
        createdAt: event.createdAt,
      };
    });
}

export type OvertureClarificationView = { clarificationId: string; question: string };

const roleLabels: Record<string, string> = {
  "conversation-lead": "conversation lead",
  "architecture-analyst": "architecture analyst",
  "external-research-scout": "research scout",
  "security-evaluator": "security evaluator",
  "design-mock-specialist": "design specialist",
  "task-editor": "task editor",
};

export function overtureRoleLabel(role: string | undefined): string {
  return role === undefined ? "overture" : (roleLabels[role] ?? role);
}

/**
 * One chat log for a session: Concertmaster turns plus Overture crew replies.
 * Overture copies of operator messages are dropped because the same text is
 * already present as the Concertmaster turn the operator sent.
 */
export function buildSessionTimeline(
  conversation: readonly ConversationMessage[],
  overture: readonly OvertureMessage[],
  pending: readonly TimelineItem[] = [],
  activity: readonly TimelineItem[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...conversation.map((message): TimelineItem => ({
      id: message.id,
      author: message.role === "operator" ? "operator" : message.role === "concertmaster" ? "concertmaster" : "system",
      content: message.content,
      createdAt: message.createdAt,
    })),
    ...overture
      .filter((message) => message.actor !== "operator")
      .map((message): TimelineItem => ({
        id: message.messageId,
        author: "overture",
        role: message.actor,
        content: message.content,
        createdAt: message.createdAt,
      })),
    ...activity,
  ];
  const known = new Set(items.map((item) => `${item.author}\u0000${item.content}`));
  for (const item of pending) if (!known.has(`${item.author}\u0000${item.content}`)) items.push(item);
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.createdAt.localeCompare(right.item.createdAt) || left.index - right.index)
    .map(({ item }) => item);
}

export function projectOpenOvertureClarification(events: readonly OvertureEvent[]): OvertureClarificationView | undefined {
  let current: OvertureClarificationView | undefined;
  for (const event of events) {
    const payload = event.payload;
    const clarificationId = typeof payload.clarificationId === "string" ? payload.clarificationId : undefined;
    if (clarificationId === undefined) continue;
    if (event.eventType === "clarification_opened") {
      const question = typeof payload.question === "string" ? payload.question : undefined;
      current = question !== undefined && question.trim() !== "" ? { clarificationId, question } : undefined;
    } else if (event.eventType === "clarification_answered" && current?.clarificationId === clarificationId) {
      current = undefined;
    }
  }
  return current;
}
