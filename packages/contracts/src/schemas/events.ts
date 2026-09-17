import { z } from "zod";
import { UuidSchema } from "./common.js";

export const EventCursorSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) => value.length < 19 || (value.length === 19 && value <= "9223372036854775807"),
    "Event cursor exceeds PostgreSQL bigint",
  );
export type EventCursor = z.infer<typeof EventCursorSchema>;

const BigintDecimalSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine((value) => value.length < 19 || (value.length === 19 && value <= "9223372036854775807"), "Value exceeds PostgreSQL bigint");

/** Wire form of a durable goal_events record. Bigints stay decimal strings. */
export const GoalEventSchema = z
  .object({
    cursor: EventCursorSchema,
    eventId: UuidSchema,
    projectId: UuidSchema,
    goalId: UuidSchema,
    aggregateVersion: BigintDecimalSchema,
    eventType: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    payload: z.record(z.string(), z.unknown()),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type GoalEvent = z.infer<typeof GoalEventSchema>;

export const EventQuerySchema = z
  .object({
    projectId: UuidSchema,
    after: EventCursorSchema.default("0"),
  })
  .strict();
export type EventQuery = z.infer<typeof EventQuerySchema>;
export const GoalEventPageSchema = z
  .object({
    events: z.array(GoalEventSchema),
    nextCursor: EventCursorSchema,
  })
  .strict();
export type GoalEventPage = z.infer<typeof GoalEventPageSchema>;
