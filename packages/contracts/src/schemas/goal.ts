import { z } from "zod";
import { CommandVersionSchema, UuidSchema } from "./common.js";

export const GoalStateSchema = z.enum([
  "draft",
  "ready_for_confirmation",
  "launched",
  "active",
  "pausing",
  "paused",
  "resuming",
  "stopping",
  "stopped",
  "blocked",
  "certifying",
  "succeeded",
  "failed",
  "recovering",
]);
export type GoalState = z.infer<typeof GoalStateSchema>;

export const CreateGoalInputSchema = z.object({ projectId: UuidSchema, contractId: UuidSchema.optional() }).strict();
export type CreateGoalInput = z.infer<typeof CreateGoalInputSchema>;

export const TransitionGoalInputSchema = z
  .object({
    projectId: UuidSchema,
    expectedVersion: CommandVersionSchema,
    to: GoalStateSchema,
  })
  .strict();
export type TransitionGoalInput = z.infer<typeof TransitionGoalInputSchema>;

/** Project-bound optimistic concurrency input shared by narrow Goal controls. */
export const GoalControlInputSchema = z
  .object({
    projectId: UuidSchema,
    expectedVersion: CommandVersionSchema,
  })
  .strict();
export type GoalControlInput = z.infer<typeof GoalControlInputSchema>;

export const GoalQuerySchema = z.object({ projectId: UuidSchema }).strict();
export type GoalQuery = z.infer<typeof GoalQuerySchema>;
/** Project binding required for every Goal-scoped read, including derived state. */
export const GoalScopedReadQuerySchema = GoalQuerySchema;
export type GoalScopedReadQuery = GoalQuery;

export const GoalResultSchema = z
  .object({
    goalId: UuidSchema,
    projectId: UuidSchema,
    contractId: UuidSchema.optional(),
    state: GoalStateSchema,
    version: CommandVersionSchema,
  })
  .strict();
export type GoalResult = z.infer<typeof GoalResultSchema>;
export const GoalListSchema = z.object({ goals: z.array(GoalResultSchema) }).strict();
export type GoalList = z.infer<typeof GoalListSchema>;
