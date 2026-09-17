import { z } from "zod";
import { UuidSchema } from "./common.js";

export const FullAccessModeSchema = z.enum(["retain_intermediate_approvals", "skip_intermediate_approvals"]);
export type FullAccessMode = z.infer<typeof FullAccessModeSchema>;
export const CapabilitySessionSelectionInputSchema = z
  .object({
    projectId: UuidSchema,
    capabilityKind: z.string().trim().min(1).max(128),
    sessionId: UuidSchema,
    fullAccessMode: FullAccessModeSchema,
  })
  .strict();
export type CapabilitySessionSelectionInput = z.infer<typeof CapabilitySessionSelectionInputSchema>;
export const CapabilitySessionSchema = z
  .object({
    sessionId: UuidSchema,
    capabilityKind: z.string().min(1),
    projectId: UuidSchema,
    goalId: UuidSchema,
    fullAccessMode: FullAccessModeSchema,
    selectedBy: z.string().min(1),
    selectedAt: z.string().datetime(),
  })
  .strict();
export type CapabilitySession = z.infer<typeof CapabilitySessionSchema>;
export const EvidenceCaptureInputSchema = z
  .object({
    projectId: UuidSchema,
    correlationId: UuidSchema,
    commandId: UuidSchema,
    kind: z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/),
    mediaType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+(?:;[a-z0-9._-]+=[a-z0-9._-]+)*$/),
    contentBase64: z.string().min(4).max(4_000_000),
  })
  .strict();
export type EvidenceCaptureInput = z.infer<typeof EvidenceCaptureInputSchema>;
export const EvidenceRecordSchema = z
  .object({
    evidenceId: UuidSchema,
    context: z
      .object({ correlationId: UuidSchema, commandId: UuidSchema, projectId: UuidSchema, goalId: UuidSchema, actorId: z.string().min(1) })
      .strict(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
    kind: z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/),
    mediaType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+(?:;[a-z0-9._-]+=[a-z0-9._-]+)*$/),
    createdAt: z.string().datetime(),
    retention: z.literal("project_lifetime"),
  })
  .strict();
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export const WorkerIntegrationInputSchema = z
  .object({
    projectId: UuidSchema,
    message: z.string().trim().min(1).max(4_096),
    evidenceReferences: z.array(z.string().min(1).max(4_096)).max(100).readonly(),
  })
  .strict();
export type WorkerIntegrationInput = z.infer<typeof WorkerIntegrationInputSchema>;
