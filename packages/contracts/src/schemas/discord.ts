import { z } from "zod";
import { UuidSchema } from "./common.js";

export const DiscordSignalSchema = z
  .object({
    incidentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    firstObservedAt: z.string().min(1),
    lastObservedAt: z.string().min(1),
    severity: z.enum(["info", "warning", "critical"]),
    confidence: z.number(),
    affectedComponent: z.string().min(1),
    affectedVersion: z.string().min(1),
    minimalReproductionEvidence: z.array(z.string()),
    source: z.string().min(1),
    sourceFreshness: z.string().min(1),
    deduplicationRelationship: z.enum(["new", "same", "related"]),
    discordHealthState: z.enum(["healthy", "degraded", "unhealthy"]),
  })
  .strict();
export const AuthenticatedDiscordSignalSchema = z
  .object({
    signal: DiscordSignalSchema,
    nonce: z.string().min(1),
    sequence: z.number().int(),
    issuedAt: z.string().min(1),
    signature: z.string().min(1),
  })
  .strict();
export type AuthenticatedDiscordSignal = z.infer<typeof AuthenticatedDiscordSignalSchema>;
export const StoredDiscordSignalSchema = z
  .object({
    incidentFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    firstObservedAt: z.string().min(1),
    lastObservedAt: z.string().min(1),
    severity: z.enum(["info", "warning", "critical"]),
    confidence: z.number(),
    affectedComponent: z.string().min(1),
    affectedVersion: z.string().min(1),
    minimalReproductionEvidence: z.array(z.string()),
    source: z.string().min(1),
    sourceFreshness: z.string().min(1),
    deduplicationRelationship: z.enum(["new", "same", "related"]),
    discordHealthState: z.enum(["healthy", "degraded", "unhealthy"]),
    signalId: UuidSchema,
    nonce: z.string().min(1),
    sequence: z.number().int(),
    issuedAt: z.string().min(1),
    signature: z.string().min(1),
    receivedAt: z.string().min(1),
  })
  .strict();
export type StoredDiscordSignal = z.infer<typeof StoredDiscordSignalSchema>;
