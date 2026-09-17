import { z } from "zod";
import { NonEmptyStringListSchema, UuidSchema } from "./common.js";
import { RoutingWorkInputSchema, TaskDemandSchema, type TaskDemand } from "./routing.js";

export const MissionBundleSubstanceSchema = z
  .object({
    role: z.enum(["head", "scout", "execution"]),
    profileRef: z.string().min(1),
    goalBrief: z.string().min(1),
    taskDemand: TaskDemandSchema,
    routingWorkInput: RoutingWorkInputSchema.optional(),
    approvedModels: NonEmptyStringListSchema,
    allowedSkills: NonEmptyStringListSchema,
    allowedTools: NonEmptyStringListSchema,
    allowedPaths: NonEmptyStringListSchema,
    environment: NonEmptyStringListSchema,
    authorityBoundary: NonEmptyStringListSchema,
    externalServiceBoundary: NonEmptyStringListSchema,
    dataBoundary: NonEmptyStringListSchema,
    costCeiling: z.string().min(1),
    timeCeiling: z.string().min(1),
    retryCeiling: z.number().int().nonnegative(),
    workerCeiling: z.number().int().nonnegative(),
    deliverable: z.string().min(1),
    evidenceRequirements: NonEmptyStringListSchema,
    validationCriteria: NonEmptyStringListSchema,
    terminationConditions: NonEmptyStringListSchema,
    repairHold: z
      .object({
        approvalId: UuidSchema,
        window: z.string().min(1),
        repetitionScope: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("bounded_count"), count: z.number().int().positive() }).strict(),
          z.object({ kind: z.literal("bounded_time"), expiresAt: z.string().datetime() }).strict(),
        ]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.routingWorkInput !== undefined &&
      (value.routingWorkInput.workCharacter.provenance.taskContractRef !== value.taskDemand.provenance.taskContractRef ||
        value.routingWorkInput.workCharacter.provenance.headDecisionRef !== value.taskDemand.provenance.headDecisionRef)
    ) {
      context.addIssue({
        code: "custom",
        path: ["routingWorkInput", "workCharacter", "provenance"],
        message: "WorkCharacter provenance must match TaskDemand provenance",
      });
    }
  });
type MissionBundleSubstanceSchemaOutput = z.infer<typeof MissionBundleSubstanceSchema>;
export type MissionBundleSubstance = Omit<MissionBundleSubstanceSchemaOutput, "taskDemand"> & { readonly taskDemand: TaskDemand };
export const MissionBundleSchema = z
  .object({
    councilId: UuidSchema,
    departmentId: z.string().min(1),
    planVersion: z.number().int().positive(),
    planContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    itemId: z.string().min(1),
    parentRef: z.string().min(1),
    substance: MissionBundleSubstanceSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type MissionBundleSchemaOutput = z.infer<typeof MissionBundleSchema>;
export type MissionBundle = Omit<MissionBundleSchemaOutput, "substance"> & { readonly substance: MissionBundleSubstance };
export const CreateMissionBundleInputSchema = z.object({ projectId: UuidSchema, substance: MissionBundleSubstanceSchema }).strict();
type CreateMissionBundleInputSchemaOutput = z.infer<typeof CreateMissionBundleInputSchema>;
export type CreateMissionBundleInput = Omit<CreateMissionBundleInputSchemaOutput, "substance"> & {
  readonly substance: MissionBundleSubstance;
};

const PersonaProfileInputSchema = z
  .object({
    agreeableness: z.number().finite().min(0).max(1),
    extraversion: z.number().finite().min(0).max(1),
    imagination: z.number().finite().min(0).max(1),
    realism: z.number().finite().min(0).max(1),
    conscientiousness: z.number().finite().min(0).max(1),
    caution: z.number().finite().min(0).max(1),
    initiative: z.number().finite().min(0).max(1),
    empathy: z.number().finite().min(0).max(1),
    adaptability: z.number().finite().min(0).max(1),
    sociability: z.number().finite().min(0).max(1),
  })
  .strict();
const MissionPersonaOverlayInputsSchema = z
  .object({
    departmentStyle: PersonaProfileInputSchema,
    headChoice: PersonaProfileInputSchema,
    taskAmbiguity: z.number().finite().min(0).max(1),
    risk: z.number().finite().min(0).max(1),
    collaborationDemand: z.number().finite().min(0).max(1),
    evidenceBurden: z.number().finite().min(0).max(1),
  })
  .strict();
export const IssueMissionPersonaOverlayInputSchema = z
  .object({
    projectId: UuidSchema,
    planVersion: z.number().int().positive(),
    inputs: MissionPersonaOverlayInputsSchema,
    missionLifetimeMs: z.number().int().positive(),
  })
  .strict();
export type IssueMissionPersonaOverlayInput = z.infer<typeof IssueMissionPersonaOverlayInputSchema>;
export const MissionPersonaOverlaySchema = z
  .object({
    councilId: z.string().min(1),
    departmentId: z.string().min(1),
    planVersion: z.number().int().positive(),
    itemId: z.string().min(1),
    persona: PersonaProfileInputSchema,
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type MissionPersonaOverlay = z.infer<typeof MissionPersonaOverlaySchema>;
