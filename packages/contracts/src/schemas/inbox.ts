import { z } from "zod";
import { ActionClassificationSchema, UuidSchema } from "./common.js";

/** A durable critical-action request that still requires an exact approval. */
export const InboxApprovalSchema = z
  .object({
    decisionId: UuidSchema,
    commandId: UuidSchema,
    projectId: UuidSchema,
    goalId: UuidSchema,
    actorId: z.string().min(1),
    action: z.string().min(1),
    target: z.string().min(1),
    policyVersion: z.number().int().nonnegative(),
    budgetEffectCents: z.number().int().nonnegative(),
    classification: ActionClassificationSchema,
    reason: z.string().min(1),
    decidedAt: z.string().datetime(),
  })
  .strict();
export type InboxApproval = z.infer<typeof InboxApprovalSchema>;
export const InboxReadSchema = z.object({ projectId: UuidSchema, items: z.array(InboxApprovalSchema).readonly() }).strict();
export type InboxRead = z.infer<typeof InboxReadSchema>;
