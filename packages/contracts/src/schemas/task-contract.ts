import { headActivationPlanContentHash } from "@maestro/domain";
import { z } from "zod";
import { CommandVersionSchema, NonEmptyStringListSchema, UuidSchema } from "./common.js";
const HeadActivationBriefSchema = z
  .object({
    departmentId: z.string().min(1),
    requestedContribution: z.string().min(1),
    urgency: z.string().min(1),
    contextScope: NonEmptyStringListSchema,
    budgetEffect: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export const HeadActivationPlanSchema = z
  .object({
    version: z.literal(1),
    departments: z.array(HeadActivationBriefSchema).min(1).readonly(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (headActivationPlanContentHash(value) !== value.contentHash) {
      context.addIssue({ code: "custom", path: ["contentHash"], message: "Head activation plan content hash does not match its content" });
    }
  });
export type HeadActivationPlan = z.infer<typeof HeadActivationPlanSchema>;

const OrganizationGroupSchema = z
  .object({
    groupId: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();
const OrganizationDepartmentSchema = z
  .object({
    departmentId: z.string().min(1),
    groupId: z.string().min(1),
    displayName: z.string().min(1),
    status: z.literal("sleeping"),
    activeSessionId: z.null(),
    goalContext: z.null(),
  })
  .strict();
/** Standing organization taxonomy exposed for the authenticated TUI orientation view. */
export const OrganizationReadModelSchema = z
  .object({
    groups: z.array(OrganizationGroupSchema).readonly(),
    departments: z.array(OrganizationDepartmentSchema).readonly(),
  })
  .strict();
export type OrganizationReadModel = z.infer<typeof OrganizationReadModelSchema>;

const TaskContractProjectSchema = z
  .object({
    projectId: UuidSchema,
    repository: z.string().min(1),
    immutableBaseRevision: z.string().min(1),
    dataBoundary: z.string().min(1),
  })
  .strict();
const TaskContractBudgetSchema = z
  .object({
    ceiling: z.string().min(1),
    reportingExpectations: NonEmptyStringListSchema,
    stoppingConditions: NonEmptyStringListSchema,
  })
  .strict();
export const TaskContractSubstanceSchema = z
  .object({
    desiredOutcome: z.string().min(1),
    userVisibleBehavior: NonEmptyStringListSchema,
    successCriteria: NonEmptyStringListSchema,
    liveEvidence: NonEmptyStringListSchema,
    scope: NonEmptyStringListSchema,
    nonGoals: NonEmptyStringListSchema,
    priorities: NonEmptyStringListSchema,
    acceptableTradeoffs: NonEmptyStringListSchema,
    constraints: NonEmptyStringListSchema,
    knownEdgeCases: NonEmptyStringListSchema,
    project: TaskContractProjectSchema,
    evidenceReferences: NonEmptyStringListSchema,
    approvedPreviewReferences: z.array(z.string()).readonly(),
    expectedGroups: NonEmptyStringListSchema,
    expectedDepartments: NonEmptyStringListSchema,
    criticalActionExpectations: NonEmptyStringListSchema,
    forbiddenEffects: NonEmptyStringListSchema,
    environmentAssumptions: NonEmptyStringListSchema,
    externalServiceAssumptions: NonEmptyStringListSchema,
    budget: TaskContractBudgetSchema,
    headActivationPlan: HeadActivationPlanSchema.optional(),
  })
  .strict();
export type TaskContractSubstance = z.infer<typeof TaskContractSubstanceSchema>;
const TaskContractDecisionSchema = z
  .object({
    decisionId: UuidSchema,
    kind: z.enum(["created", "amended", "overture_selected"]),
    evidence: z.record(z.string(), z.unknown()),
  })
  .strict();
export const TaskContractSchema = TaskContractSubstanceSchema.extend({
  contractId: UuidSchema,
  schemaVersion: z.literal(1),
  version: CommandVersionSchema,
  decisionHistory: z.array(TaskContractDecisionSchema).readonly(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  launchState: z.enum(["awaiting_confirmation", "launched"]),
}).strict();
export type TaskContract = z.infer<typeof TaskContractSchema>;
export const CreateTaskContractInputSchema = z
  .object({
    projectId: UuidSchema,
    substance: TaskContractSubstanceSchema,
  })
  .strict();
export type CreateTaskContractInput = z.infer<typeof CreateTaskContractInputSchema>;
export const UpdateTaskContractInputSchema = z
  .object({
    projectId: UuidSchema,
    expectedVersion: CommandVersionSchema,
    substance: TaskContractSubstanceSchema,
    evidence: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type UpdateTaskContractInput = z.infer<typeof UpdateTaskContractInputSchema>;
export const TaskContractQuerySchema = z.object({ projectId: UuidSchema }).strict();
export type TaskContractQuery = z.infer<typeof TaskContractQuerySchema>;
export const OvertureSelectionInputSchema = z
  .object({
    projectId: UuidSchema,
    outsideEvidenceRequested: z.boolean(),
    previewNeeded: z.boolean(),
  })
  .strict();
export type OvertureSelectionInput = z.infer<typeof OvertureSelectionInputSchema>;
export const TaskContractConfirmationInputSchema = z
  .object({
    projectId: UuidSchema,
    version: CommandVersionSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type TaskContractConfirmationInput = z.infer<typeof TaskContractConfirmationInputSchema>;
export const OvertureRoleSelectionResultSchema = z.object({ roles: z.array(z.string().min(1)) }).strict();
export type OvertureRoleSelectionResult = z.infer<typeof OvertureRoleSelectionResultSchema>;

export const TaskContractLaunchResultSchema = z
  .object({
    taskContract: TaskContractSchema,
    goalId: UuidSchema,
    scheduling: z.literal("queued"),
  })
  .strict();
export type TaskContractLaunchResult = z.infer<typeof TaskContractLaunchResultSchema>;
