import { z } from "zod";
import { UuidSchema } from "./common.js";

/** Human/operator budget view: envelope, planned allocations, and incurred spend are separate. */
export const GoalBudgetSummarySchema = z
  .object({
    goalId: UuidSchema,
    projectId: UuidSchema,
    budgetCents: z.number().int().nonnegative(),
    reservedCents: z.number().int().nonnegative(),
    costCents: z.number().int().nonnegative(),
  })
  .strict();
export type GoalBudgetSummary = z.infer<typeof GoalBudgetSummarySchema>;

/** Project billing rollup built only from durable Goal summaries and incurred-cost timestamps. */
export const BillingDailySpendSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    costCents: z.number().int().nonnegative(),
  })
  .strict();
export type BillingDailySpend = z.infer<typeof BillingDailySpendSchema>;

export const BillingGoalSummarySchema = z
  .object({
    goalId: UuidSchema,
    budgetCents: z.number().int().nonnegative(),
    reservedCents: z.number().int().nonnegative(),
    costCents: z.number().int().nonnegative(),
  })
  .strict();
export type BillingGoalSummary = z.infer<typeof BillingGoalSummarySchema>;

export const BillingDepartmentBreakdownUnavailableSchema = z
  .object({
    available: z.literal(false),
    reason: z.string().min(1),
  })
  .strict();
export type BillingDepartmentBreakdownUnavailable = z.infer<typeof BillingDepartmentBreakdownUnavailableSchema>;

export const BillingReadModelSchema = z
  .object({
    projectId: UuidSchema,
    periodDays: z.literal(14),
    dailySpend: z.array(BillingDailySpendSchema).length(14),
    goals: z.array(BillingGoalSummarySchema).readonly(),
    totals: BillingGoalSummarySchema.omit({ goalId: true }),
    departmentBreakdown: BillingDepartmentBreakdownUnavailableSchema,
  })
  .strict();
export type BillingReadModel = z.infer<typeof BillingReadModelSchema>;

/** Project access provisioning request. Roles are canonical permanent role IDs, never free-form capabilities. */
const ProjectRoleIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid project role ID")
  .max(128);
export const ProjectAccessProvisionInputSchema = z
  .object({
    operatorId: UuidSchema,
    projectId: UuidSchema,
    roles: z.array(ProjectRoleIdSchema).min(1).max(32),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.roles).size !== input.roles.length) {
      context.addIssue({ code: "custom", path: ["roles"], message: "roles must not contain duplicates" });
    }
  });
export type ProjectAccessProvisionInput = z.infer<typeof ProjectAccessProvisionInputSchema>;
export const ProjectAccessProvisionResultSchema = z
  .object({
    operatorId: UuidSchema,
    projectId: UuidSchema,
    roles: z.array(ProjectRoleIdSchema).min(1).max(32),
  })
  .strict();
export type ProjectAccessProvisionResult = z.infer<typeof ProjectAccessProvisionResultSchema>;
