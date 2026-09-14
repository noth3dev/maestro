import { z } from "zod";
import type { ImprovementCandidate, ImprovementCandidateInput } from "@maestro/domain";
const PERSONA_AXES = ["agreeableness", "extraversion", "imagination", "realism", "conscientiousness", "caution", "initiative", "empathy", "adaptability", "sociability"] as const;

const AxisSchema = z.number().finite().min(0).max(1);
const ProfileSchema = z.object(Object.fromEntries(PERSONA_AXES.map((axis) => [axis, AxisSchema]))).strict();
const DeltaSchema = z.record(z.string(), z.number().finite().min(-1).max(1));
const CoreIdentitySchema = z.object({
  mission: z.string().min(1), authority: z.array(z.string().min(1)).readonly(), truthfulness: z.string().min(1), safety: z.string().min(1), prohibitedBehavior: z.array(z.string().min(1)).readonly(),
}).strict();
const CandidateInputSchema = z.custom<ImprovementCandidateInput>((value) => value !== null && typeof value === "object");
const CandidateSchema = z.object({
  candidate: z.custom<ImprovementCandidate>((value) => value !== null && typeof value === "object").optional(), candidateId: z.string().min(1), version: z.number().int().positive(), state: z.string().min(1), changedAxes: z.array(z.string().min(1)).readonly(), decision: z.string().min(1), invalidated: z.boolean(),
}).strict();
const RolloutEvidenceSchema = z.object({ kind: z.string().min(1), evidenceId: z.string().min(1) }).strict();
const RolloutSchema = z.object({
  rolloutId: z.string().min(1), status: z.string().min(1), activeCandidateId: z.string().min(1), activeVersion: z.number().int().positive(),
  rollbackTarget: z.object({ candidateId: z.string().min(1), version: z.number().int().positive(), contentHash: z.string().min(1) }).strict(),
  evidence: z.array(RolloutEvidenceSchema).readonly(),
}).strict();

export const PersonaInspectionSchema = z.object({
  roleId: z.string().min(1), taskClass: z.string().min(1), profile: ProfileSchema, version: z.number().int().positive(), coreIdentity: CoreIdentitySchema,
  taskClassAdjustment: z.object({ roleId: z.string().min(1), taskClass: z.string().min(1), version: z.number().int().positive(), delta: DeltaSchema, reason: z.string().min(1) }).strict(),
  missionOverlay: DeltaSchema, proposalTemplate: CandidateInputSchema.optional(), candidates: z.array(CandidateSchema).readonly(), rollouts: z.array(RolloutSchema).readonly(),
}).strict();
export type PersonaInspection = z.infer<typeof PersonaInspectionSchema>;

export const PersonaReadQuerySchema = z.object({ projectId: z.string().uuid(), goalId: z.string().uuid(), roleId: z.string().min(1), taskClass: z.string().min(1) }).strict();
export type PersonaReadQuery = z.infer<typeof PersonaReadQuerySchema>;

export const PersonaProposalInputSchema = z.object({ projectId: z.string().uuid(), goalId: z.string().uuid(), candidate: CandidateInputSchema }).strict();
export type PersonaProposalInput = z.infer<typeof PersonaProposalInputSchema>;
export const ImprovementCandidateResponseSchema = z.custom<ImprovementCandidate>((value) => value !== null && typeof value === "object");

export type { ImprovementCandidate, ImprovementCandidateInput } from "@maestro/domain";
