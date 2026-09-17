import { z } from "zod";
import { UuidSchema } from "./common.js";

const ArrangementCandidateTargetSchema = z
  .object({
    roleId: z.string().min(1).optional(),
    taskClass: z.string().min(1).optional(),
    routingTarget: z.string().min(1).optional(),
  })
  .strict();
const ArrangementCandidateChangeSchema = z
  .object({ axis: z.string().min(1), currentValue: z.number().finite(), proposedValue: z.number().finite() })
  .strict();
const ArrangementMetricDeltaSchema = z
  .object({ name: z.string().min(1), baseline: z.number().finite(), candidate: z.number().finite(), delta: z.number().finite() })
  .strict();
const ArrangementEvaluationSchema = z
  .object({
    evaluationId: UuidSchema,
    evaluationHash: z.string().regex(/^[a-f0-9]{64}$/),
    stages: z.object({ replay: z.string().min(1), shadow: z.string().min(1), synthetic: z.string().min(1) }).strict(),
    metricDeltas: z.array(ArrangementMetricDeltaSchema),
  })
  .strict();
const ArrangementRolloutSchema = z
  .object({
    rolloutId: UuidSchema,
    status: z.enum(["active", "interrupted", "certified", "rolled_back"]),
    activeCandidateId: UuidSchema,
    activeVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const ArrangementCouncilJudgmentSchema = z
  .object({
    modelProvider: z.string().min(1),
    modelId: z.string().min(1),
    verdict: z.enum(["proceed", "do_not_proceed", "escalate"]),
    confidence: z.enum(["low", "medium", "high"]),
    reasoning: z.string().min(1),
    conditions: z.array(z.string()),
    dissentNote: z.string().nullable(),
    citedEvidenceIds: z.array(UuidSchema),
  })
  .strict();
const ArrangementCandidateSchema = z
  .object({
    candidateId: UuidSchema,
    version: z.number().int().positive(),
    parentCandidateId: UuidSchema.nullable(),
    projectId: UuidSchema,
    goalId: UuidSchema,
    kind: z.enum(["persona_axis", "routing_capability_axis"]),
    state: z.enum(["candidate", "evaluated", "judged", "applied", "rejected", "retained", "rolled_back"]),
    target: ArrangementCandidateTargetSchema,
    changes: z.array(ArrangementCandidateChangeSchema),
    sourceEvidenceIds: z.array(UuidSchema),
    predictedEffect: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    evaluation: ArrangementEvaluationSchema.nullable(),
    rollout: ArrangementRolloutSchema.nullable(),
    rejectionReason: z.string().nullable(),
  })
  .strict();
const ArrangementCouncilSchema = z
  .object({
    candidateId: UuidSchema,
    roundId: UuidSchema,
    question: z.string().min(1),
    finalVerdict: z.enum(["proceed", "do_not_proceed", "escalate"]),
    reviewerCount: z.number().int().positive(),
    sameModelOnly: z.boolean(),
    escalated: z.boolean(),
    dissentNotes: z.array(z.string()),
    judgments: z.array(ArrangementCouncilJudgmentSchema),
  })
  .strict();
const ArrangementNegativeEvidenceSchema = z
  .object({
    candidateId: UuidSchema,
    state: z.literal("rejected"),
    reason: z.string().min(1).nullable(),
    roundId: UuidSchema.nullable(),
    judgments: z.array(ArrangementCouncilJudgmentSchema),
  })
  .strict();
export const ArrangementsReadSchema = z
  .object({
    active: z.array(ArrangementCandidateSchema),
    candidates: z.array(ArrangementCandidateSchema),
    encoreCouncil: z.array(ArrangementCouncilSchema),
    negativeEvidence: z.array(ArrangementNegativeEvidenceSchema),
  })
  .strict();
export type ArrangementsRead = z.infer<typeof ArrangementsReadSchema>;
export type ArrangementCandidate = ArrangementsRead["active"][number];
export type ArrangementCouncil = ArrangementsRead["encoreCouncil"][number];
export type ArrangementNegativeEvidence = ArrangementsRead["negativeEvidence"][number];
