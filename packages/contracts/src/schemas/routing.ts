import { z } from "zod";
import { NonEmptyStringListSchema, taskDemandHash } from "./common.js";

const TaskKindSchema = z.enum(["planning", "coding", "verification", "research", "debugging", "tool-operation"]);
const NonEmptyLineSchema = z.string().regex(/^(?=[^\r\n]*\S)[^\r\n]+$/);
const TaskCapabilityRequirementSchema = z
  .object({
    level: z.number().int().min(0).max(200),
    rationale: NonEmptyLineSchema,
  })
  .strict();

export const TaskDemandSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskKinds: z
      .array(TaskKindSchema)
      .min(1)
      .refine((kinds) => new Set(kinds).size === kinds.length, "taskKinds must not contain duplicates"),
    requirements: z
      .object({
        reasoning: TaskCapabilityRequirementSchema,
        coding: TaskCapabilityRequirementSchema,
        verification: TaskCapabilityRequirementSchema,
        "instruction-fidelity": TaskCapabilityRequirementSchema,
        "tool-use": TaskCapabilityRequirementSchema,
        "long-context": TaskCapabilityRequirementSchema,
        knowledge: TaskCapabilityRequirementSchema,
        "refusal-calibration": TaskCapabilityRequirementSchema,
      })
      .strict(),
    provenance: z.object({ taskContractRef: NonEmptyLineSchema, headDecisionRef: NonEmptyLineSchema }).strict(),
  })
  .strict();
type TaskDemandSchemaOutput = z.infer<typeof TaskDemandSchema>;
export type TaskDemand = Omit<TaskDemandSchemaOutput, "taskKinds"> & {
  readonly taskKinds: ReadonlyArray<z.infer<typeof TaskKindSchema>>;
};
type AssertFalse<T extends false> = T;
type _TaskDemandTaskKindsMustBeReadonly = AssertFalse<TaskDemand["taskKinds"] extends unknown[] ? true : false>;

const ProviderFactLineListSchema = z
  .array(NonEmptyLineSchema)
  .min(1)
  .refine((values) => new Set(values).size === values.length, "values must not contain duplicates");
const ProviderFactRetentionSchema = z.enum(["none", "transient", "persistent"]);
const ProviderFactTrainingUseSchema = z.enum(["never", "opt-in", "always"]);
export const ProviderFactsSchema = z
  .object({
    schemaVersion: z.literal(1),
    contextCapacity: z.number().int().positive(),
    pricing: z
      .object({ inputPerMillionTokens: z.number().finite().nonnegative(), outputPerMillionTokens: z.number().finite().nonnegative() })
      .strict(),
    authentication: z.object({ modes: ProviderFactLineListSchema }).strict(),
    dataPolicy: z
      .object({
        allowedDataClasses: ProviderFactLineListSchema,
        retention: ProviderFactRetentionSchema,
        trainingUse: ProviderFactTrainingUseSchema,
        regions: ProviderFactLineListSchema,
      })
      .strict(),
    modalities: ProviderFactLineListSchema,
    toolCalls: z.object({ supported: z.boolean() }).strict(),
    provenance: z.object({ source: NonEmptyLineSchema, observedAt: NonEmptyLineSchema }).strict(),
  })
  .strict();
export type ProviderFacts = z.infer<typeof ProviderFactsSchema>;

const OperationalObservationSchema = z
  .object({
    candidateRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
    measuredLatencyMs: z.number().finite().nonnegative(),
    measuredCost: z.number().finite().nonnegative(),
    failureRate: z.number().finite().min(0).max(1),
    timeoutRate: z.number().finite().min(0).max(1),
    providerErrorRate: z.number().finite().min(0).max(1),
    currentAvailability: z.boolean(),
    accountBinding: z.string().min(1).nullable(),
    observedAt: NonEmptyLineSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.currentAvailability && value.accountBinding === null)
      context.addIssue({ code: "custom", path: ["accountBinding"], message: "available observations require an account binding" });
  });
const OperationalObservationListSchema = z
  .array(OperationalObservationSchema)
  .refine(
    (values) => new Set(values.map((value) => value.candidateRef)).size === values.length,
    "observations must not duplicate candidateRef",
  );
export const OperationalOverlaySchema = z
  .object({
    schemaVersion: z.literal(1),
    installationRef: NonEmptyLineSchema,
    projectRef: NonEmptyLineSchema,
    version: z.number().int().positive(),
    observations: OperationalObservationListSchema,
  })
  .strict();
export type OperationalOverlay = z.infer<typeof OperationalOverlaySchema>;
export const OperationalOverlaySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    installationRef: NonEmptyLineSchema,
    projectRef: NonEmptyLineSchema,
    goalRef: NonEmptyLineSchema,
    overlayVersion: z.number().int().positive(),
    observations: OperationalObservationListSchema,
  })
  .strict();
export type OperationalOverlaySnapshot = z.infer<typeof OperationalOverlaySnapshotSchema>;

export const PressureBandProjectionSchema = z
  .object({
    pressure: z.number().finite().min(0).max(200),
    band: z.enum(["low", "medium", "high", "critical"]),
    decisionLayer: z.enum(["automatic progress", "Department Head", "Encore Council", "user"]),
  })
  .strict();
export type PressureBandProjection = z.infer<typeof PressureBandProjectionSchema>;

const ModelCapabilityScoreSchema = z
  .object({
    status: z.enum(["scored", "unproven"]),
    score: z.number().int().min(0).max(200).nullable(),
    rationale: NonEmptyLineSchema,
    evidence: NonEmptyStringListSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "scored" && value.score === null)
      context.addIssue({ code: "custom", path: ["score"], message: "scored capability requires a score" });
    if (value.status === "unproven" && value.score !== null)
      context.addIssue({ code: "custom", path: ["score"], message: "unproven capability must have a null score" });
  });
const ModelCapabilityVectorSchema = z
  .object({
    schemaVersion: z.literal(2),
    axes: z
      .object({
        reasoning: ModelCapabilityScoreSchema,
        coding: ModelCapabilityScoreSchema,
        verification: ModelCapabilityScoreSchema,
        "instruction-fidelity": ModelCapabilityScoreSchema,
        "tool-use": ModelCapabilityScoreSchema,
        "long-context": ModelCapabilityScoreSchema,
        knowledge: ModelCapabilityScoreSchema,
        "refusal-calibration": ModelCapabilityScoreSchema,
      })
      .strict(),
  })
  .strict();
const ModelProfileSchema = z
  .object({
    modelRef: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    capability: ModelCapabilityVectorSchema,
    providerFacts: ProviderFactsSchema,
    provenance: z.object({ owner: z.literal("human"), sourceRefs: NonEmptyStringListSchema, reviewedAt: NonEmptyLineSchema }).strict(),
  })
  .strict();
const PressureCalculationSchema = z
  .object({
    pressureFloor: z.number().finite().min(0).max(200),
    pressure: z.number().finite().min(0).max(200),
    explicitHeadUplift: z.number().int().min(0).max(200),
  })
  .strict();
const WorkCharacterSchema = z
  .object({
    schemaVersion: z.literal(1),
    risk: z.number().int().min(0).max(200),
    reversibility: z.number().int().min(0).max(200),
    verificationAttachment: z.number().int().min(0).max(200),
    materialScale: z.number().int().min(0).max(200),
    timePressure: z.number().int().min(0).max(200),
    budgetHeadroom: z.number().int().min(0).max(200),
    provenance: z.object({ taskContractRef: NonEmptyLineSchema, headDecisionRef: NonEmptyLineSchema }).strict(),
  })
  .strict();
export const RoutingWorkInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    workCharacter: WorkCharacterSchema,
    explicitHeadUplift: z.number().int().min(0).max(200),
  })
  .strict();
const RoutingRefSchema = z.string().regex(/^\S+$/);
const RoutingCandidateRefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const RoutingApprovalIdentitySchema = z
  .object({
    capabilityKind: RoutingRefSchema,
    commandId: RoutingRefSchema,
    action: RoutingRefSchema,
    target: RoutingRefSchema,
  })
  .strict();
function assertOrdinaryRoutingShape(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("routing evidence must not contain cycles");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("routing evidence arrays must use the standard prototype");
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (key === "length") {
          if (!descriptor || descriptor.enumerable || !("value" in descriptor) || descriptor.value !== value.length)
            throw new Error("routing evidence array length is invalid");
        } else if (
          typeof key !== "string" ||
          !/^(?:0|[1-9]\d*)$/.test(key) ||
          Number(key) >= value.length ||
          !descriptor?.enumerable ||
          !("value" in descriptor)
        ) {
          throw new Error("routing evidence array contains an extra or accessor property");
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new Error("routing evidence arrays must not be sparse");
        assertOrdinaryRoutingShape(value[index], seen);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("routing evidence objects must be plain");
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor))
        throw new Error("routing evidence object contains an extra or accessor property");
      assertOrdinaryRoutingShape(descriptor.value, seen);
    }
  } finally {
    seen.delete(value);
  }
}

const RoutingEvidenceHostileShapeGuard = z.unknown().superRefine((value, context) => {
  try {
    assertOrdinaryRoutingShape(value);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "routing evidence shape is invalid" });
  }
});

const RoutingEvidencePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceId: RoutingRefSchema,
    goalRef: RoutingRefSchema,
    projectRef: RoutingRefSchema,
    routeRef: RoutingRefSchema,
    mode: z.enum(["ensemble", "pin"]),
    selectedModelRef: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    accountBinding: RoutingRefSchema,
    candidateRefs: z
      .array(RoutingCandidateRefSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length, "candidateRefs must not contain duplicates"),
    selectedCandidateRef: RoutingCandidateRefSchema,
    rejections: z.array(z.object({ candidateRef: NonEmptyLineSchema, reason: NonEmptyLineSchema }).strict()),
    taskDemandHash: z.string().regex(/^[a-f0-9]{64}$/),
    pressure: z.number().finite().min(0).max(200),
    pressureBand: z.enum(["low", "medium", "high", "critical"]),
    decisionLayer: z.enum(["automatic progress", "Department Head", "Encore Council", "user"]),
    overlayVersion: z.number().int().positive(),
    admissionBindingRef: RoutingRefSchema,
    rationale: NonEmptyLineSchema,
    createdAt: z.string().datetime(),
    pressureCalculation: PressureCalculationSchema,
    taskKindRecipeVersions: z.record(z.string().min(1), z.number().int().positive()),
    taskDemand: TaskDemandSchema,
    workCharacter: WorkCharacterSchema,
    modelProfile: ModelProfileSchema,
    operationalOverlaySnapshot: OperationalOverlaySnapshotSchema,
    approvalRef: RoutingRefSchema.nullable(),
    approvalIdentity: RoutingApprovalIdentitySchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.candidateRefs.includes(value.selectedCandidateRef))
      context.addIssue({ code: "custom", path: ["selectedCandidateRef"], message: "selected candidate must be in candidateRefs" });
    const knownKinds = new Set(["planning", "coding", "verification", "research", "debugging", "tool-operation"]);
    const demandedKinds = new Set<string>(value.taskDemand.taskKinds);
    const recipeKeys = Object.keys(value.taskKindRecipeVersions);
    if (
      recipeKeys.length !== demandedKinds.size ||
      recipeKeys.some((kind) => !demandedKinds.has(kind) || !knownKinds.has(kind) || value.taskKindRecipeVersions[kind] !== 1)
    )
      context.addIssue({
        code: "custom",
        path: ["taskKindRecipeVersions"],
        message: "recipe versions must exactly match known task kinds",
      });
    const expectedFloor =
      (value.workCharacter.risk + (200 - value.workCharacter.reversibility) + value.workCharacter.verificationAttachment) / 3;
    const expectedPressure = Math.max(expectedFloor, value.pressureCalculation.explicitHeadUplift);
    if (
      value.pressureCalculation.pressureFloor !== expectedFloor ||
      value.pressureCalculation.pressure !== expectedPressure ||
      value.pressure !== expectedPressure
    )
      context.addIssue({ code: "custom", path: ["pressureCalculation"], message: "pressure calculation does not match WorkCharacter" });
    const expectedBand = value.pressure < 50 ? "low" : value.pressure < 100 ? "medium" : value.pressure < 150 ? "high" : "critical";
    const expectedLayer =
      expectedBand === "low"
        ? "automatic progress"
        : expectedBand === "medium"
          ? "Department Head"
          : expectedBand === "high"
            ? "Encore Council"
            : "user";
    if (value.pressureBand !== expectedBand || value.decisionLayer !== expectedLayer)
      context.addIssue({ code: "custom", path: ["pressureBand"], message: "pressure projection does not match pressure" });
    if (value.taskDemandHash !== taskDemandHash(value.taskDemand))
      context.addIssue({ code: "custom", path: ["taskDemandHash"], message: "taskDemandHash does not match taskDemand" });
    const selectedObservation = value.operationalOverlaySnapshot.observations.find(
      (observation) => observation.candidateRef === value.selectedCandidateRef,
    );
    if (
      selectedObservation === undefined ||
      !selectedObservation.currentAvailability ||
      selectedObservation.accountBinding !== value.accountBinding ||
      value.candidateRefs.some(
        (candidate) => !value.operationalOverlaySnapshot.observations.some((observation) => observation.candidateRef === candidate),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["operationalOverlaySnapshot"],
        message: "candidate set/account binding is not covered by operational observations",
      });
    if ((value.approvalRef === null) !== (value.approvalIdentity === null))
      context.addIssue({
        code: "custom",
        path: ["approvalIdentity"],
        message: "approvalRef and approvalIdentity must be supplied together",
      });
    if (
      value.taskDemand.provenance.taskContractRef !== value.workCharacter.provenance.taskContractRef ||
      value.taskDemand.provenance.headDecisionRef !== value.workCharacter.provenance.headDecisionRef
    )
      context.addIssue({
        code: "custom",
        path: ["workCharacter", "provenance"],
        message: "TaskDemand and WorkCharacter provenance must agree",
      });
    if (
      value.operationalOverlaySnapshot.projectRef !== value.projectRef ||
      value.operationalOverlaySnapshot.goalRef !== value.goalRef ||
      value.operationalOverlaySnapshot.overlayVersion !== value.overlayVersion
    )
      context.addIssue({
        code: "custom",
        path: ["operationalOverlaySnapshot"],
        message: "overlay snapshot identity must match routing evidence",
      });
    if (value.modelProfile.modelRef !== value.selectedModelRef)
      context.addIssue({ code: "custom", path: ["modelProfile", "modelRef"], message: "model profile identity must match selected model" });
  });
export const RoutingEvidenceSchema = RoutingEvidenceHostileShapeGuard.pipe(RoutingEvidencePayloadSchema);
export type RoutingEvidence = z.infer<typeof RoutingEvidenceSchema>;
