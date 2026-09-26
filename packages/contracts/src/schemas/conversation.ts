import { z } from "zod";
import { CommandVersionSchema, ModelRefSchema, UuidSchema } from "./common.js";

export const ConversationStatusSchema = z.enum(["active", "running", "succeeded", "failed", "cancelled", "unknown"]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;
export const ConversationSchema = z
  .object({
    conversationId: UuidSchema,
    projectId: UuidSchema,
    goalId: UuidSchema.nullable(),
    model: ModelRefSchema,
    reasoningEffort: z.string().min(1).nullable().optional(),
    status: ConversationStatusSchema,
    version: CommandVersionSchema,
  })
  .strict();
export type Conversation = z.infer<typeof ConversationSchema>;
export const ConversationSummarySchema = z
  .object({
    conversationId: UuidSchema,
    projectId: UuidSchema,
    goalId: UuidSchema.nullable(),
    model: ModelRefSchema,
    status: ConversationStatusSchema,
    title: z.string().max(200).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export const ConversationListQuerySchema = z
  .object({ projectId: UuidSchema, limit: z.coerce.number().int().min(1).max(200).default(50) })
  .strict();
export type ConversationListQuery = z.input<typeof ConversationListQuerySchema>;
const WorkspaceRevisionSchema = z.string().regex(/^[0-9a-f]{40}$/).nullable();
export const SessionWorkspaceListingSchema = z
  .object({
    files: z.array(z.object({ path: z.string().min(1).max(256), size: z.number().int().min(0) }).strict()).max(2000),
    revision: WorkspaceRevisionSchema,
  })
  .strict();
export type SessionWorkspaceListing = z.infer<typeof SessionWorkspaceListingSchema>;
export const SessionWorkspaceFileSchema = z
  .object({ path: z.string().min(1).max(256), content: z.string(), revision: WorkspaceRevisionSchema })
  .strict();
export type SessionWorkspaceFile = z.infer<typeof SessionWorkspaceFileSchema>;
export const SessionWorkspaceFileQuerySchema = z.object({ projectId: UuidSchema, path: z.string().min(1).max(256) }).strict();
export type SessionWorkspaceFileQuery = z.infer<typeof SessionWorkspaceFileQuerySchema>;
export const CreateConversationInputSchema = z
  .object({ projectId: UuidSchema, goalId: UuidSchema.nullable().default(null), model: ModelRefSchema, reasoningEffort: z.string().min(1).optional() })
  .strict();
export type CreateConversationInput = z.input<typeof CreateConversationInputSchema>;
export const ConversationTurnInputSchema = z.object({ projectId: UuidSchema, text: z.string().min(1).max(64_000) }).strict();
export type ConversationTurnInput = z.infer<typeof ConversationTurnInputSchema>;
export const ConversationTurnSchema = z
  .object({
    turnId: UuidSchema,
    conversationId: UuidSchema,
    role: z.enum(["user", "assistant", "tool"]),
    content: z.string().max(64_000),
    status: z.enum(["accepted", "completed", "failed", "cancelled", "unknown"]),
    cursor: z.string().regex(/^(0|[1-9][0-9]*)$/),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
export const ConversationTurnResultSchema = z.object({ conversation: ConversationSchema, turn: ConversationTurnSchema }).strict();
export type ConversationTurnResult = z.infer<typeof ConversationTurnResultSchema>;
export const ConversationEventSchema = z
  .object({
    cursor: z.string().regex(/^(0|[1-9][0-9]*)$/),
    eventId: UuidSchema,
    conversationId: UuidSchema,
    projectId: UuidSchema,
    eventType: z.enum([
      "conversation_created",
      "turn_started",
      "turn_delta",
      "turn_completed",
      "turn_failed",
      "turn_cancelled",
      "turn_unknown",
    ]),
    payload: z.record(z.string(), z.unknown()),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;

/** Ephemeral, non-replayable activity signal for live agent UX. Never carries model reasoning, tool arguments, or tool output. */
export const ConversationActivityEventSchema = z
  .object({
    activityId: UuidSchema,
    conversationId: UuidSchema,
    projectId: UuidSchema,
    turnId: UuidSchema,
    phase: z.enum(["thinking", "writing", "tool-call", "executing", "tool-result", "waiting", "error"]),
    toolName: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
    status: z.enum(["proposed", "validated", "executing", "ok", "error", "unknown", "cancelled"]).optional(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type ConversationActivityEvent = z.infer<typeof ConversationActivityEventSchema>;

export const ConversationEventQuerySchema = z
  .object({
    projectId: UuidSchema,
    after: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .default("0"),
  })
  .strict();
export type ConversationEventQuery = z.infer<typeof ConversationEventQuerySchema>;

/** Maximum persisted conversation text in bytes; mirrors ConversationTurnInputSchema's max on write paths. */
export const MAX_PERSISTED_TEXT_BYTES = 60_000;

/** Truncate to a byte budget without splitting surrogate pairs. */
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
