import { z } from "zod";
import { ActionClassificationSchema, BudgetEffectCentsSchema, UuidSchema } from "./common.js";

/** Body for the single critical-action gateway call site (Phase 1 exit gate). */
export const CriticalActionInputSchema = z
  .object({
    projectId: UuidSchema,
    action: z.string().min(1),
    target: z.string().min(1),
    policyVersion: z.number().int().min(0),
    budgetEffectCents: BudgetEffectCentsSchema,
  })
  .strict();
export type CriticalActionInput = z.infer<typeof CriticalActionInputSchema>;

/** CEO approval is explicit, time-bounded, and carries the exact action scope. */
export const CriticalActionApprovalInputSchema = CriticalActionInputSchema.extend({
  expiresAt: z.string().datetime(),
}).strict();
export type CriticalActionApprovalInput = z.infer<typeof CriticalActionApprovalInputSchema>;

/** Only an "allow" decision reaches a 200 response; deny/require_approval map to stable API errors. */
export const CriticalActionResultSchema = z
  .object({
    goalId: UuidSchema,
    effect: z.literal("allow"),
    reason: z.string().min(1),
    classification: ActionClassificationSchema,
    recordId: UuidSchema.optional(),
  })
  .strict();
export type CriticalActionResult = z.infer<typeof CriticalActionResultSchema>;
