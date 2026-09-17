import { z } from "zod";
import { UuidSchema } from "./common.js";

export const MetronomeChallengeSchema = z
  .object({
    challengeId: UuidSchema,
    goalId: UuidSchema,
    reason: z.string().min(1),
    evidenceReferences: z.array(z.string()),
    status: z.enum(["open", "correction_requested", "safe_paused", "resolved"]),
    correctionRequest: z.string().nullable(),
    raisedBy: z.string().min(1),
    resolvedBy: z.string().nullable(),
    resolutionReason: z.string().nullable(),
    targetRef: z.string().nullable(),
  })
  .strict();
export type MetronomeChallenge = z.infer<typeof MetronomeChallengeSchema>;
export const MetronomeChallengeListSchema = z.object({ challenges: z.array(MetronomeChallengeSchema) }).strict();
export type MetronomeChallengeList = z.infer<typeof MetronomeChallengeListSchema>;
export const MetronomeFindingSchema = z
  .object({
    findingId: UuidSchema,
    goalId: UuidSchema,
    ruleId: z.string().min(1),
    evidenceIdentity: z.string().min(1),
    planVersion: z.number().int().positive(),
    details: z.record(z.string(), z.unknown()),
    resolved: z.boolean(),
  })
  .strict();
export const MetronomeFindingListSchema = z.object({ findings: z.array(MetronomeFindingSchema).readonly() }).strict();
export type MetronomeFindingList = z.infer<typeof MetronomeFindingListSchema>;
export const MetronomeScanInputSchema = z.object({ projectId: UuidSchema }).strict();
export type MetronomeScanInput = z.infer<typeof MetronomeScanInputSchema>;
export const RaiseMetronomeChallengeInputSchema = z
  .object({
    projectId: UuidSchema,
    findingIds: z.array(UuidSchema),
    reason: z.string().min(1),
    evidenceReferences: z.array(z.string().min(1)),
  })
  .strict();
export type RaiseMetronomeChallengeInput = z.infer<typeof RaiseMetronomeChallengeInputSchema>;
export const WorkerOverlayChallengeInputSchema = z
  .object({ projectId: UuidSchema, workerId: UuidSchema, roleId: z.string().min(1), evidenceReferences: z.array(z.string().min(1)).min(1) })
  .strict();
export type WorkerOverlayChallengeInput = z.infer<typeof WorkerOverlayChallengeInputSchema>;
export const MetronomeCorrectionInputSchema = z.object({ projectId: UuidSchema, correctionRequest: z.string().min(1) }).strict();
export type MetronomeCorrectionInput = z.infer<typeof MetronomeCorrectionInputSchema>;
export const MetronomeSafePauseInputSchema = z.object({ projectId: UuidSchema }).strict();
export type MetronomeSafePauseInput = z.infer<typeof MetronomeSafePauseInputSchema>;
export const MetronomeResolutionInputSchema = z.object({ projectId: UuidSchema, reason: z.string().min(1) }).strict();
export type MetronomeResolutionInput = z.infer<typeof MetronomeResolutionInputSchema>;
