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
    status: ConversationStatusSchema,
    version: CommandVersionSchema,
  })
  .strict();
export type Conversation = z.infer<typeof ConversationSchema>;
export const CreateConversationInputSchema = z
  .object({ projectId: UuidSchema, goalId: UuidSchema.nullable().default(null), model: ModelRefSchema })
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
