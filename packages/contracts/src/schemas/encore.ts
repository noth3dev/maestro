import { z } from "zod";
import { UuidSchema } from "./common.js";

const CouncilJudgmentSchema = z
  .object({
    modelProvider: z.string().min(1),
    modelId: z.string().min(1),
    verdict: z.enum(["proceed", "do_not_proceed", "escalate"]),
    confidence: z.enum(["low", "medium", "high"]),
    reasoning: z.string().min(1),
    conditions: z.array(z.string()),
    dissentNote: z.string().nullable(),
    citedEvidenceIds: z.array(z.string()),
  })
  .strict();
const CouncilSynthesisSchema = z
  .object({
    finalVerdict: z.enum(["proceed", "do_not_proceed", "escalate"]),
    sameModelOnly: z.boolean(),
    escalated: z.boolean(),
    dissentNotes: z.array(z.string()).readonly(),
  })
  .strict();
export const EncoreCouncilRoundListSchema = z
  .object({
    rounds: z.array(
      z
        .object({
          roundId: UuidSchema,
          goalId: UuidSchema,
          question: z.string().min(1),
          criteria: z.array(z.object({ criterionId: z.string(), description: z.string() }).strict()),
          evidenceIds: z.array(z.string()),
          triggerReasons: z.array(z.string()),
          reviewerCount: z.number().int().positive(),
          judgments: z.array(CouncilJudgmentSchema),
          synthesis: CouncilSynthesisSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type EncoreCouncilRoundList = z.infer<typeof EncoreCouncilRoundListSchema>;
export const EncoreReviewInputSchema = z
  .object({
    projectId: UuidSchema,
    question: z.string().min(1),
    criteria: z.array(z.object({ criterionId: z.string().min(1), description: z.string().min(1) }).strict()).min(1),
    evidenceIds: z.array(z.string().min(1)),
    reviewerCount: z.number().int().min(1).max(8),
  })
  .strict();
export type EncoreReviewInput = z.infer<typeof EncoreReviewInputSchema>;
const EncoreResultJudgmentSchema = z
  .object({
    modelProvider: z.string().min(1),
    modelId: z.string().min(1),
    verdict: z.enum(["proceed", "do_not_proceed", "escalate"]),
    confidence: z.enum(["low", "medium", "high"]),
    reasoning: z.string().min(1),
    conditions: z.array(z.string()).readonly(),
    dissentNote: z.string().nullable(),
    citedEvidenceIds: z.array(z.string()).readonly(),
  })
  .strict();
export const EncoreCouncilResultSchema = z
  .object({ roundId: UuidSchema, judgments: z.array(EncoreResultJudgmentSchema).readonly(), synthesis: CouncilSynthesisSchema })
  .strict();
export type EncoreCouncilResult = z.infer<typeof EncoreCouncilResultSchema>;
