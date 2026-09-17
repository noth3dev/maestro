import { z } from "zod";
import { CommandVersionSchema, NonEmptyStringListSchema, UuidSchema } from "./common.js";

/** Goal-scoped Head activation request. The control plane derives Head identity and session. */
export const HeadParticipationInputSchema = z
  .object({
    projectId: UuidSchema,
    departmentId: z.string().min(1),
    headRoleId: z.string().min(1).optional(),
    contractId: UuidSchema.optional(),
    contextId: z.string().min(1).optional(),
    requestedContribution: z.string().min(1),
    urgency: z.string().min(1),
    contextScope: z.array(z.string().min(1)).min(1).readonly(),
    budgetEffect: z.string().min(1),
    reason: z.string().min(1),
    evidence: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type HeadParticipationInput = z.infer<typeof HeadParticipationInputSchema>;
export const HeadParticipationSchema = z
  .object({
    goalId: UuidSchema,
    departmentId: z.string().min(1),
    headRoleId: z.string().min(1),
    contractId: UuidSchema.nullable(),
    contextId: z.string().nullable(),
    status: z.enum(["starting", "active", "sleeping"]),
    activeSessionRef: z.string().nullable(),
  })
  .strict();
export type HeadParticipation = z.infer<typeof HeadParticipationSchema>;

const IndependentBriefSchema = z
  .object({
    interpretation: z.string().min(1),
    contribution: z.string().min(1),
    nonGoals: NonEmptyStringListSchema,
    assumptions: NonEmptyStringListSchema,
    evidenceGaps: NonEmptyStringListSchema,
    risks: NonEmptyStringListSchema,
    dependencies: NonEmptyStringListSchema,
    proposedValidation: NonEmptyStringListSchema,
    expectedWorkers: NonEmptyStringListSchema,
    expectedCost: z.string().min(1),
    expectedTime: z.string().min(1),
    objectionsToLikelyAlternatives: NonEmptyStringListSchema,
  })
  .strict();
export const CreateHeadCouncilInputSchema = z
  .object({
    projectId: UuidSchema,
    contractId: UuidSchema,
    briefDeadline: z.string().datetime(),
    evidence: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CreateHeadCouncilInput = z.infer<typeof CreateHeadCouncilInputSchema>;
export const SubmitCouncilBriefInputSchema = z.object({ projectId: UuidSchema, brief: IndependentBriefSchema }).strict();
export type SubmitCouncilBriefInput = z.infer<typeof SubmitCouncilBriefInputSchema>;
const CouncilDecisionPacketSchema = z
  .object({
    outcome: z.enum(["decided", "escalated"]),
    executionDisposition: z.enum(["executable", "non_executable"]),
    selectedDirection: z.string().min(1),
    rejectedAlternatives: z.array(z.object({ alternative: z.string().min(1), reason: z.string().min(1) }).strict()),
    departmentOwnership: z.array(z.object({ departmentId: z.string().min(1), responsibility: z.string().min(1) }).strict()),
    workerPlan: z.array(z.object({ departmentId: z.string().min(1), plan: z.string().min(1) }).strict()),
    completionCriteria: NonEmptyStringListSchema,
    failureCriteria: NonEmptyStringListSchema,
    dissent: NonEmptyStringListSchema,
    uncertainty: NonEmptyStringListSchema,
    criticalActions: NonEmptyStringListSchema,
    unresolvedConflicts: NonEmptyStringListSchema,
    evidenceReferences: NonEmptyStringListSchema,
  })
  .strict();
export const HeadCouncilDecisionInputSchema = z.object({ projectId: UuidSchema, packet: CouncilDecisionPacketSchema }).strict();
export type HeadCouncilDecisionInput = z.infer<typeof HeadCouncilDecisionInputSchema>;
export const HeadCouncilSchema = z
  .object({
    councilId: UuidSchema,
    goalId: UuidSchema,
    contractId: UuidSchema,
    briefDeadline: z.string().datetime(),
    state: z.enum(["collecting", "revealed", "resolved", "escalated", "stopped_no_new_evidence"]),
    noNewEvidenceStreak: z.number().int().nonnegative(),
    decisionPacket: z.unknown(),
    snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot: z.unknown(),
  })
  .strict();
export type HeadCouncil = z.infer<typeof HeadCouncilSchema>;

const DepartmentPlanItemSchema = z
  .object({
    itemId: z.string().min(1),
    kind: z.enum(["scout", "execution"]),
    objective: z.string().min(1),
    dependsOn: z.array(z.string().min(1)).readonly(),
    scoutQuestion: z.string(),
    workerAssignment: z.string(),
    evidenceReferences: z.array(z.string().min(1)).readonly(),
  })
  .strict();
export const DepartmentPlanSubstanceSchema = z
  .object({
    contribution: z.string().min(1),
    nonGoals: NonEmptyStringListSchema,
    items: z.array(DepartmentPlanItemSchema).min(1).readonly(),
    requiredHandoffs: NonEmptyStringListSchema,
    budgetCeiling: z.string().min(1),
    expectedTime: z.string().min(1),
    maxRetries: z.number().int().nonnegative(),
    maxWorkers: z.number().int().nonnegative(),
    gitRepository: z.string().min(1),
    gitBranch: z.string().min(1),
    integrationPath: z.string().min(1),
    risks: NonEmptyStringListSchema,
    safePausePoints: NonEmptyStringListSchema,
    escalationTriggers: NonEmptyStringListSchema,
    evidenceReferences: NonEmptyStringListSchema,
    validationCriteria: NonEmptyStringListSchema,
  })
  .strict();
export type DepartmentPlanSubstance = z.infer<typeof DepartmentPlanSubstanceSchema>;
export const DepartmentPlanSchema = z
  .object({
    projectId: UuidSchema,
    goalId: UuidSchema,
    councilId: UuidSchema,
    councilSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    decisionPacketHash: z.string().regex(/^[a-f0-9]{64}$/),
    contractId: UuidSchema,
    contractVersion: CommandVersionSchema,
    contractContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    departmentId: z.string().min(1),
    headRoleId: z.string().min(1),
    version: z.number().int().positive(),
    substance: DepartmentPlanSubstanceSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type DepartmentPlan = z.infer<typeof DepartmentPlanSchema>;
export const CreateDepartmentPlanInputSchema = z.object({ projectId: UuidSchema, substance: DepartmentPlanSubstanceSchema }).strict();
export type CreateDepartmentPlanInput = z.infer<typeof CreateDepartmentPlanInputSchema>;
export const ReviseDepartmentPlanInputSchema = z
  .object({
    projectId: UuidSchema,
    expectedVersion: CommandVersionSchema,
    substance: DepartmentPlanSubstanceSchema,
    reason: z.string().min(1),
  })
  .strict();
export type ReviseDepartmentPlanInput = z.infer<typeof ReviseDepartmentPlanInputSchema>;
