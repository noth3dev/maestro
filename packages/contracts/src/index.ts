import { z } from "zod";

export const UuidSchema = z.uuid();
export const CommandVersionSchema = z.number().int().min(0);

export const GoalStateSchema = z.enum([
  "draft", "ready_for_confirmation", "launched", "active", "pausing", "paused",
  "resuming", "stopping", "stopped", "blocked", "certifying", "succeeded", "failed", "recovering",
]);
export type GoalState = z.infer<typeof GoalStateSchema>;

export const CreateGoalInputSchema = z.object({ projectId: UuidSchema }).strict();
export type CreateGoalInput = z.infer<typeof CreateGoalInputSchema>;

export const TransitionGoalInputSchema = z.object({
  projectId: UuidSchema,
  expectedVersion: CommandVersionSchema,
  to: GoalStateSchema,
}).strict();
export type TransitionGoalInput = z.infer<typeof TransitionGoalInputSchema>;

export const GoalQuerySchema = z.object({ projectId: UuidSchema }).strict();
export type GoalQuery = z.infer<typeof GoalQuerySchema>;

export const GoalResultSchema = z.object({
  goalId: UuidSchema,
  projectId: UuidSchema,
  state: GoalStateSchema,
  version: CommandVersionSchema,
}).strict();
export type GoalResult = z.infer<typeof GoalResultSchema>;

export const StableApiErrorCodeSchema = z.enum([
  "validation_error", "version_conflict", "invalid_transition", "goal_not_found",
  "stale_lease", "lease_unavailable", "command_id_reused", "durable_store_unavailable",
  "authentication_required", "authentication_unavailable", "credential_forbidden",
  "critical_action_denied", "critical_action_requires_approval",
]);
export const StableApiErrorSchema = z.object({
  error: z.object({ code: StableApiErrorCodeSchema, message: z.string().min(1) }).strict(),
}).strict();
export type StableApiError = z.infer<typeof StableApiErrorSchema>;


/** Exact decimal PostgreSQL bigint text. It deliberately never accepts a JS number. */
export const EventCursorSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(
  (value) => value.length < 19 || (value.length === 19 && value <= "9223372036854775807"),
  "Event cursor exceeds PostgreSQL bigint",
);
export type EventCursor = z.infer<typeof EventCursorSchema>;

const BigintDecimalSchema = z.string().regex(/^[1-9][0-9]*$/).refine(
  (value) => value.length < 19 || (value.length === 19 && value <= "9223372036854775807"),
  "Value exceeds PostgreSQL bigint",
);

/** Wire form of a durable goal_events record. Bigints stay decimal strings. */
export const GoalEventSchema = z.object({
  cursor: EventCursorSchema,
  eventId: UuidSchema,
  projectId: UuidSchema,
  goalId: UuidSchema,
  aggregateVersion: BigintDecimalSchema,
  eventType: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
}).strict();
export type GoalEvent = z.infer<typeof GoalEventSchema>;

export const EventQuerySchema = z.object({
  projectId: UuidSchema,
  after: EventCursorSchema.default("0"),
}).strict();
export type EventQuery = z.infer<typeof EventQuerySchema>;
export const GoalEventPageSchema = z.object({
  events: z.array(GoalEventSchema),
  nextCursor: EventCursorSchema,
}).strict();
export type GoalEventPage = z.infer<typeof GoalEventPageSchema>;

export const ActionClassificationSchema = z.enum(["ordinary", "critical", "forbidden", "ambiguous"]);
export type ActionClassification = z.infer<typeof ActionClassificationSchema>;

/** Body for the single critical-action gateway call site (Phase 1 exit gate). */
export const CriticalActionInputSchema = z.object({
  projectId: UuidSchema,
  action: z.string().min(1),
  target: z.string().min(1),
  policyVersion: z.number().int().min(0),
  budgetEffectCents: z.number().int(),
}).strict();
export type CriticalActionInput = z.infer<typeof CriticalActionInputSchema>;

/** Only an "allow" decision reaches a 200 response; deny/require_approval map to stable API errors. */
export const CriticalActionResultSchema = z.object({
  goalId: UuidSchema,
  effect: z.literal("allow"),
  reason: z.string().min(1),
  classification: ActionClassificationSchema,
  recordId: UuidSchema.optional(),
}).strict();
export type CriticalActionResult = z.infer<typeof CriticalActionResultSchema>;
