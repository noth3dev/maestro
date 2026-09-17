import { z } from "zod";
import { UuidSchema } from "./common.js";

export const EvidenceBundleReadSchema = z
  .object({
    bundleId: UuidSchema,
    goalId: UuidSchema,
    content: z.record(z.string(), z.unknown()),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type EvidenceBundleRead = z.infer<typeof EvidenceBundleReadSchema>;

export const ImprovementDigestMetricSchema = z
  .object({ name: z.string().min(1), value: z.number().finite(), unit: z.string().min(1) })
  .strict();
export const ImprovementDigestSourceRefSchema = z
  .object({
    kind: z.enum(["goal", "evidence_record", "evidence_bundle", "metronome_finding", "discord_improvement_evidence", "encore_round"]),
    sourceId: z.string().min(1),
  })
  .strict();
export const ImprovementDigestSchema = z
  .object({
    digestId: UuidSchema,
    schemaVersion: z.literal(1),
    projectId: UuidSchema,
    goalId: UuidSchema,
    episodeId: z.string().min(1),
    trigger: z.enum([
      "worker_completed",
      "worker_failed",
      "worker_cancelled",
      "department_handoff",
      "council_decision",
      "goal_completed",
      "goal_failed",
      "goal_rollback",
      "incident_closed",
      "cost_threshold",
      "quality_signal",
    ]),
    situation: z.string().min(1),
    selectedDecision: z.string().min(1),
    rejectedAlternatives: z.array(z.string()),
    observedResult: z.string().min(1),
    metrics: z.array(ImprovementDigestMetricSchema),
    confidence: z.number().min(0).max(1),
    sourceRefs: z.array(ImprovementDigestSourceRefSchema),
    contentHash: z.string().min(1),
    authorId: z.string().min(1),
    sessionRef: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();
export type ImprovementDigest = z.infer<typeof ImprovementDigestSchema>;
export const ImprovementDigestListSchema = z.object({ digests: z.array(ImprovementDigestSchema) }).strict();
export type ImprovementDigestList = z.infer<typeof ImprovementDigestListSchema>;
