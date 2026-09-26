import { z } from "zod";
import { GOAL_PLAN_SLICE_STATUSES, GOAL_PLAN_STATUSES } from "@maestro/domain";
import { UuidSchema } from "./common.js";

export const GoalPlanStatusSchema = z.enum(GOAL_PLAN_STATUSES);
export const GoalPlanSliceStatusSchema = z.enum(GOAL_PLAN_SLICE_STATUSES);

export const GoalPlanPhaseSchema = z.object({ phaseNo: z.number().int().positive(), title: z.string(), outcome: z.string() }).strict();

export const GoalPlanSliceSchema = z
  .object({
    sliceId: z.string().regex(/^p[1-9][0-9]*s[1-9][0-9]*$/),
    phaseNo: z.number().int().positive(),
    departmentId: z.string().min(1),
    title: z.string(),
    objective: z.string(),
    acceptance: z.array(z.string()),
    dependsOn: z.array(z.string()),
    status: GoalPlanSliceStatusSchema,
    statusReason: z.string().nullable(),
  })
  .strict();
export type GoalPlanSliceRead = z.infer<typeof GoalPlanSliceSchema>;

/** The Department Heads' execution plan for a Goal (phases and `p<phase>s<n>` slices). */
export const GoalPlanSchema = z
  .object({
    goalId: UuidSchema,
    projectId: UuidSchema,
    version: z.number().int().positive(),
    status: GoalPlanStatusSchema,
    councilId: UuidSchema.nullable(),
    contentHash: z.string(),
    approvalRef: z.string().nullable(),
    phases: z.array(GoalPlanPhaseSchema),
    slices: z.array(GoalPlanSliceSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type GoalPlan = z.infer<typeof GoalPlanSchema>;

/** `plan` is null until the Heads have proposed one. */
export const GoalPlanReadSchema = z.object({ plan: GoalPlanSchema.nullable() }).strict();
export type GoalPlanRead = z.infer<typeof GoalPlanReadSchema>;
