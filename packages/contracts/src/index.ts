import { createHash } from "node:crypto";
import { z } from "zod";

export const UuidSchema = z.uuid();
export const CommandVersionSchema = z.number().int().min(0);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
function taskDemandHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export const GoalStateSchema = z.enum([
  "draft", "ready_for_confirmation", "launched", "active", "pausing", "paused",
  "resuming", "stopping", "stopped", "blocked", "certifying", "succeeded", "failed", "recovering",
]);
export type GoalState = z.infer<typeof GoalStateSchema>;

export const CreateGoalInputSchema = z.object({ projectId: UuidSchema, contractId: UuidSchema.optional() }).strict();
export type CreateGoalInput = z.infer<typeof CreateGoalInputSchema>;

export const TransitionGoalInputSchema = z.object({
  projectId: UuidSchema,
  expectedVersion: CommandVersionSchema,
  to: GoalStateSchema,
}).strict();
export type TransitionGoalInput = z.infer<typeof TransitionGoalInputSchema>;

/** Project-bound optimistic concurrency input shared by narrow Goal controls. */
export const GoalControlInputSchema = z.object({
  projectId: UuidSchema,
  expectedVersion: CommandVersionSchema,
}).strict();
export type GoalControlInput = z.infer<typeof GoalControlInputSchema>;

export const GoalQuerySchema = z.object({ projectId: UuidSchema }).strict();
export type GoalQuery = z.infer<typeof GoalQuerySchema>;
/** Project binding required for every Goal-scoped read, including derived state. */
export const GoalScopedReadQuerySchema = GoalQuerySchema;
export type GoalScopedReadQuery = GoalQuery;

export const GoalResultSchema = z.object({
  goalId: UuidSchema,
  projectId: UuidSchema,
  contractId: UuidSchema.optional(),
  state: GoalStateSchema,
  version: CommandVersionSchema,
}).strict();
export type GoalResult = z.infer<typeof GoalResultSchema>;
export const GoalListSchema = z.object({ goals: z.array(GoalResultSchema) }).strict();
export type GoalList = z.infer<typeof GoalListSchema>;


export const ModelRefSchema = z.string().regex(/^[^\s/]+\/[^\s/]+$/).max(320);
export type ModelRef = z.infer<typeof ModelRefSchema>;
export const ConversationStatusSchema = z.enum(["active", "running", "succeeded", "failed", "cancelled", "unknown"]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;
export const ConversationSchema = z.object({
  conversationId: UuidSchema,
  projectId: UuidSchema,
  goalId: UuidSchema,
  model: ModelRefSchema,
  status: ConversationStatusSchema,
  version: CommandVersionSchema,
}).strict();
export type Conversation = z.infer<typeof ConversationSchema>;
export const CreateConversationInputSchema = z.object({ projectId: UuidSchema, goalId: UuidSchema, model: ModelRefSchema }).strict();
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;
export const ConversationTurnInputSchema = z.object({ projectId: UuidSchema, text: z.string().min(1).max(64_000) }).strict();
export type ConversationTurnInput = z.infer<typeof ConversationTurnInputSchema>;
export const ConversationTurnSchema = z.object({
  turnId: UuidSchema,
  conversationId: UuidSchema,
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().max(64_000),
  status: z.enum(["accepted", "completed", "failed", "cancelled", "unknown"]),
  cursor: z.string().regex(/^(0|[1-9][0-9]*)$/),
  createdAt: z.string().datetime(),
}).strict();
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
export const ConversationTurnResultSchema = z.object({ conversation: ConversationSchema, turn: ConversationTurnSchema }).strict();
export type ConversationTurnResult = z.infer<typeof ConversationTurnResultSchema>;
export const ConversationEventSchema = z.object({
  cursor: z.string().regex(/^(0|[1-9][0-9]*)$/),
  eventId: UuidSchema,
  conversationId: UuidSchema,
  projectId: UuidSchema,
  eventType: z.enum(["conversation_created", "turn_started", "turn_delta", "turn_completed", "turn_failed", "turn_cancelled", "turn_unknown"]),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
}).strict();
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;
export const ConversationEventQuerySchema = z.object({ projectId: UuidSchema, after: z.string().regex(/^(0|[1-9][0-9]*)$/).default("0") }).strict();
export type ConversationEventQuery = z.infer<typeof ConversationEventQuerySchema>;
export const ModelCatalogEntrySchema = z.object({
  identity: z.object({ provider: z.string().min(1), id: z.string().min(1) }).strict(),
  capabilities: z.array(z.string().min(1)),
  authModes: z.array(z.enum(["api-key", "managed-subscription"])),
  dataPolicy: z.object({
    allowedDataClasses: z.array(z.enum(["public", "workspace", "private", "pii", "phi", "secret"])),
    retention: z.enum(["none", "provider-policy", "durable"]),
    trainsOnCustomerData: z.boolean(),
    regions: z.array(z.string().min(1)),
  }).strict(),
}).strict();
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;

/** Provider login accepts only the two statically registered API-key adapters. */
export const ProviderCredentialLoginInputSchema = z.object({
  providerId: z.enum(["openai", "anthropic"]),
  authMode: z.literal("api-key"),
  secret: z.string().min(1).max(512),
}).strict();
export type ProviderCredentialLoginInput = z.infer<typeof ProviderCredentialLoginInputSchema>;
const ProviderCredentialBindingCommonSchema = {
  bindingId: z.string().min(1).max(128),
  accountRef: z.string().min(1).max(256),
  configuredAt: z.string().datetime(),
} as const;
export const ProviderCredentialBindingSchema = z.union([
  z.object({ ...ProviderCredentialBindingCommonSchema, providerId: z.enum(["openai", "anthropic"]), authMode: z.literal("api-key") }).strict(),
  z.object({ ...ProviderCredentialBindingCommonSchema, providerId: z.literal("openai-codex"), authMode: z.literal("managed-subscription") }).strict(),
]);
export type ProviderCredentialBinding = z.infer<typeof ProviderCredentialBindingSchema>;

/** Browser-based account login is deliberately limited to the public Codex app-server boundary. */
export const ProviderAccountLoginStartInputSchema = z.object({ providerId: z.literal("openai-codex") }).strict();
export type ProviderAccountLoginStartInput = z.infer<typeof ProviderAccountLoginStartInputSchema>;
export const ProviderAccountLoginStartResultSchema = z.object({
  providerId: z.literal("openai-codex"),
  loginId: z.string().min(1).max(256),
  authUrl: z.string().url().max(2048),
}).strict();
export type ProviderAccountLoginStartResult = z.infer<typeof ProviderAccountLoginStartResultSchema>;
export const ProviderAccountLoginStatusSchema = z.object({
  providerId: z.literal("openai-codex"),
  loginId: z.string().min(1).max(256),
  state: z.enum(["pending", "succeeded", "failed", "cancelled", "unknown"]),
  message: z.string().max(512).optional(),
}).strict();
export type ProviderAccountLoginStatus = z.infer<typeof ProviderAccountLoginStatusSchema>;

/** Project identities visible to the authenticated operator for workspace attachment. */
export const ProjectListSchema = z.object({ projects: z.array(UuidSchema) }).strict();
export type ProjectList = z.infer<typeof ProjectListSchema>;

const NonEmptyStringListSchema = z.array(z.string().min(1)).readonly();
const TaskContractProjectSchema = z.object({
  projectId: UuidSchema,
  repository: z.string().min(1),
  immutableBaseRevision: z.string().min(1),
  dataBoundary: z.string().min(1),
}).strict();
const TaskContractBudgetSchema = z.object({
  ceiling: z.string().min(1),
  reportingExpectations: NonEmptyStringListSchema,
  stoppingConditions: NonEmptyStringListSchema,
}).strict();
export const TaskContractSubstanceSchema = z.object({
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
}).strict();
export type TaskContractSubstance = z.infer<typeof TaskContractSubstanceSchema>;
const TaskContractDecisionSchema = z.object({
  decisionId: UuidSchema,
  kind: z.enum(["created", "amended", "overture_selected"]),
  evidence: z.record(z.string(), z.unknown()),
}).strict();
export const TaskContractSchema = TaskContractSubstanceSchema.extend({
  contractId: UuidSchema,
  schemaVersion: z.literal(1),
  version: CommandVersionSchema,
  decisionHistory: z.array(TaskContractDecisionSchema).readonly(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  launchState: z.enum(["awaiting_confirmation", "launched"]),
}).strict();
export type TaskContract = z.infer<typeof TaskContractSchema>;
export const CreateTaskContractInputSchema = z.object({
  projectId: UuidSchema,
  substance: TaskContractSubstanceSchema,
}).strict();
export type CreateTaskContractInput = z.infer<typeof CreateTaskContractInputSchema>;
export const UpdateTaskContractInputSchema = z.object({
  projectId: UuidSchema,
  expectedVersion: CommandVersionSchema,
  substance: TaskContractSubstanceSchema,
  evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type UpdateTaskContractInput = z.infer<typeof UpdateTaskContractInputSchema>;
export const TaskContractQuerySchema = z.object({ projectId: UuidSchema }).strict();
export type TaskContractQuery = z.infer<typeof TaskContractQuerySchema>;
export const OvertureSelectionInputSchema = z.object({
  projectId: UuidSchema,
  outsideEvidenceRequested: z.boolean(),
  previewNeeded: z.boolean(),
}).strict();
export type OvertureSelectionInput = z.infer<typeof OvertureSelectionInputSchema>;
export const TaskContractConfirmationInputSchema = z.object({
  projectId: UuidSchema,
  version: CommandVersionSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type TaskContractConfirmationInput = z.infer<typeof TaskContractConfirmationInputSchema>;
export const OvertureRoleSelectionResultSchema = z.object({ roles: z.array(z.string().min(1)) }).strict();
export type OvertureRoleSelectionResult = z.infer<typeof OvertureRoleSelectionResultSchema>;

/** Human/operator budget view: envelope, planned allocations, and incurred spend are separate. */
export const GoalBudgetSummarySchema = z.object({
  goalId: UuidSchema, projectId: UuidSchema,
  budgetCents: z.number().int().nonnegative(),
  reservedCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative(),
}).strict();
export type GoalBudgetSummary = z.infer<typeof GoalBudgetSummarySchema>;

/** Project access provisioning request. Roles are canonical permanent role IDs, never free-form capabilities. */
const ProjectRoleIdSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid project role ID").max(128);
export const ProjectAccessProvisionInputSchema = z.object({
  operatorId: UuidSchema,
  projectId: UuidSchema,
  roles: z.array(ProjectRoleIdSchema).min(1).max(32),
}).strict().superRefine((input, context) => {
  if (new Set(input.roles).size !== input.roles.length) {
    context.addIssue({ code: "custom", path: ["roles"], message: "roles must not contain duplicates" });
  }
});
export type ProjectAccessProvisionInput = z.infer<typeof ProjectAccessProvisionInputSchema>;
export const ProjectAccessProvisionResultSchema = z.object({
  operatorId: UuidSchema,
  projectId: UuidSchema,
  roles: z.array(ProjectRoleIdSchema).min(1).max(32),
}).strict();
export type ProjectAccessProvisionResult = z.infer<typeof ProjectAccessProvisionResultSchema>;

export const StableApiErrorCodeSchema = z.enum([
  "validation_error", "version_conflict", "invalid_transition", "goal_not_found",
  "stale_lease", "lease_unavailable", "command_id_reused", "durable_store_unavailable",
  "authentication_required", "authentication_unavailable", "credential_forbidden",
  "critical_action_denied", "authority_denied", "critical_action_requires_approval", "critical_action_approval_forbidden", "head_activation_cycle", "head_activation_conflict", "council_not_found", "council_conflict", "council_briefs_sealed", "department_plan_not_found", "department_plan_conflict", "mission_bundle_not_found", "mission_bundle_conflict", "worker_not_found", "worker_conflict", "git_integration_not_found", "git_integration_conflict", "certification_not_found", "certification_conflict", "metronome_not_found", "metronome_conflict", "encore_not_found", "encore_conflict", "project_access_forbidden",
  "task_contract_not_found", "task_contract_conflict", "task_contract_version_conflict",
  "exact_confirmation_required", "task_contract_integrity_error", "discord_signal_rejected", "worker_capacity_exceeded", "worker_message_rejected",
  "conversation_not_found", "conversation_conflict", "conversation_unavailable", "model_not_allowed", "provider_unavailable", "account_login_session_unknown",
  "capability_unauthorized", "replay_conflict",
]);
export const StableApiErrorSchema = z.object({
  error: z.object({ code: StableApiErrorCodeSchema, message: z.string().min(1) }).strict(),
}).strict();
export type StableApiError = z.infer<typeof StableApiErrorSchema>;


/** Exact decimal PostgreSQL bigint text. It deliberately never accepts a JS number. */
export const EventCursorSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(
  (value) => value.length < 19 || (value.length === 19 && value <= "9223372036854775807"),
  "Event cursor exceeds PostgreSQL bigint",
);
export type EventCursor = z.infer<typeof EventCursorSchema>;

const BigintDecimalSchema = z.string().regex(/^[1-9][0-9]*$/).refine(
  (value) => value.length < 19 || (value.length === 19 && value <= "9223372036854775807"),
  "Value exceeds PostgreSQL bigint",
);

/** Wire form of a durable goal_events record. Bigints stay decimal strings. */
export const GoalEventSchema = z.object({
  cursor: EventCursorSchema,
  eventId: UuidSchema,
  projectId: UuidSchema,
  goalId: UuidSchema,
  aggregateVersion: BigintDecimalSchema,
  eventType: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
}).strict();
export type GoalEvent = z.infer<typeof GoalEventSchema>;

export const EventQuerySchema = z.object({
  projectId: UuidSchema,
  after: EventCursorSchema.default("0"),
}).strict();
export type EventQuery = z.infer<typeof EventQuerySchema>;
export const GoalEventPageSchema = z.object({
  events: z.array(GoalEventSchema),
  nextCursor: EventCursorSchema,
}).strict();
export type GoalEventPage = z.infer<typeof GoalEventPageSchema>;

export const ActionClassificationSchema = z.enum(["ordinary", "critical", "forbidden", "ambiguous"]);
export type ActionClassification = z.infer<typeof ActionClassificationSchema>;

/** Single-effect budget cap: ten million dollars expressed in cents. */
export const MaxBudgetEffectCents = 1_000_000_000;
export const BudgetEffectCentsSchema = z.number().int().nonnegative().safe().max(MaxBudgetEffectCents);

/** Body for the single critical-action gateway call site (Phase 1 exit gate). */
export const CriticalActionInputSchema = z.object({
  projectId: UuidSchema,
  action: z.string().min(1),
  target: z.string().min(1),
  policyVersion: z.number().int().min(0),
  budgetEffectCents: BudgetEffectCentsSchema,
}).strict();
export type CriticalActionInput = z.infer<typeof CriticalActionInputSchema>;

/** Goal-scoped Head activation request. The control plane derives Head identity and session. */
export const HeadParticipationInputSchema = z.object({
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
}).strict();
export type HeadParticipationInput = z.infer<typeof HeadParticipationInputSchema>;
export const HeadParticipationSchema = z.object({
  goalId: UuidSchema,
  departmentId: z.string().min(1),
  headRoleId: z.string().min(1),
  contractId: UuidSchema.nullable(),
  contextId: z.string().nullable(),
  status: z.enum(["starting", "active", "sleeping"]),
  activeSessionRef: z.string().nullable(),
}).strict();
export type HeadParticipation = z.infer<typeof HeadParticipationSchema>;

const IndependentBriefSchema = z.object({
  interpretation: z.string().min(1), contribution: z.string().min(1), nonGoals: NonEmptyStringListSchema,
  assumptions: NonEmptyStringListSchema, evidenceGaps: NonEmptyStringListSchema, risks: NonEmptyStringListSchema,
  dependencies: NonEmptyStringListSchema, proposedValidation: NonEmptyStringListSchema, expectedWorkers: NonEmptyStringListSchema,
  expectedCost: z.string().min(1), expectedTime: z.string().min(1), objectionsToLikelyAlternatives: NonEmptyStringListSchema,
}).strict();
export const CreateHeadCouncilInputSchema = z.object({
  projectId: UuidSchema, contractId: UuidSchema, briefDeadline: z.string().datetime(), evidence: z.record(z.string(), z.unknown()),
}).strict();
export type CreateHeadCouncilInput = z.infer<typeof CreateHeadCouncilInputSchema>;
export const SubmitCouncilBriefInputSchema = z.object({ projectId: UuidSchema, brief: IndependentBriefSchema }).strict();
export type SubmitCouncilBriefInput = z.infer<typeof SubmitCouncilBriefInputSchema>;
const CouncilDecisionPacketSchema = z.object({
  outcome: z.enum(["decided", "escalated"]), executionDisposition: z.enum(["executable", "non_executable"]),
  selectedDirection: z.string().min(1),
  rejectedAlternatives: z.array(z.object({ alternative: z.string().min(1), reason: z.string().min(1) }).strict()),
  departmentOwnership: z.array(z.object({ departmentId: z.string().min(1), responsibility: z.string().min(1) }).strict()),
  workerPlan: z.array(z.object({ departmentId: z.string().min(1), plan: z.string().min(1) }).strict()),
  completionCriteria: NonEmptyStringListSchema, failureCriteria: NonEmptyStringListSchema, dissent: NonEmptyStringListSchema,
  uncertainty: NonEmptyStringListSchema, criticalActions: NonEmptyStringListSchema, unresolvedConflicts: NonEmptyStringListSchema,
  evidenceReferences: NonEmptyStringListSchema,
}).strict();
export const HeadCouncilDecisionInputSchema = z.object({ projectId: UuidSchema, packet: CouncilDecisionPacketSchema }).strict();
export type HeadCouncilDecisionInput = z.infer<typeof HeadCouncilDecisionInputSchema>;
export const HeadCouncilSchema = z.object({
  councilId: UuidSchema, goalId: UuidSchema, contractId: UuidSchema, briefDeadline: z.string().datetime(),
  state: z.enum(["collecting", "revealed", "resolved", "escalated", "stopped_no_new_evidence"]), noNewEvidenceStreak: z.number().int().nonnegative(),
  decisionPacket: z.unknown(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), snapshot: z.unknown(),
}).strict();
export type HeadCouncil = z.infer<typeof HeadCouncilSchema>;

const DepartmentPlanItemSchema = z.object({
  itemId: z.string().min(1), kind: z.enum(["scout", "execution"]), objective: z.string().min(1), dependsOn: z.array(z.string().min(1)).readonly(),
  scoutQuestion: z.string(), workerAssignment: z.string(), evidenceReferences: z.array(z.string().min(1)).readonly(),
}).strict();
export const DepartmentPlanSubstanceSchema = z.object({
  contribution: z.string().min(1), nonGoals: NonEmptyStringListSchema, items: z.array(DepartmentPlanItemSchema).min(1).readonly(),
  requiredHandoffs: NonEmptyStringListSchema, budgetCeiling: z.string().min(1), expectedTime: z.string().min(1),
  maxRetries: z.number().int().nonnegative(), maxWorkers: z.number().int().nonnegative(), gitRepository: z.string().min(1),
  gitBranch: z.string().min(1), integrationPath: z.string().min(1), risks: NonEmptyStringListSchema, safePausePoints: NonEmptyStringListSchema,
  escalationTriggers: NonEmptyStringListSchema, evidenceReferences: NonEmptyStringListSchema, validationCriteria: NonEmptyStringListSchema,
}).strict();
export type DepartmentPlanSubstance = z.infer<typeof DepartmentPlanSubstanceSchema>;
export const DepartmentPlanSchema = z.object({
  projectId: UuidSchema, goalId: UuidSchema, councilId: UuidSchema, councilSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  decisionPacketHash: z.string().regex(/^[a-f0-9]{64}$/), contractId: UuidSchema, contractVersion: CommandVersionSchema,
  contractContentHash: z.string().regex(/^[a-f0-9]{64}$/), departmentId: z.string().min(1), headRoleId: z.string().min(1),
  version: z.number().int().positive(), substance: DepartmentPlanSubstanceSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type DepartmentPlan = z.infer<typeof DepartmentPlanSchema>;
export const CreateDepartmentPlanInputSchema = z.object({ projectId: UuidSchema, substance: DepartmentPlanSubstanceSchema }).strict();
export type CreateDepartmentPlanInput = z.infer<typeof CreateDepartmentPlanInputSchema>;
export const ReviseDepartmentPlanInputSchema = z.object({ projectId: UuidSchema, expectedVersion: CommandVersionSchema, substance: DepartmentPlanSubstanceSchema, reason: z.string().min(1) }).strict();
export type ReviseDepartmentPlanInput = z.infer<typeof ReviseDepartmentPlanInputSchema>;

const TaskKindSchema = z.enum(["planning", "coding", "verification", "research", "debugging", "tool-operation"]);
const NonEmptyLineSchema = z.string().regex(/^(?=[^\r\n]*\S)[^\r\n]+$/);
const TaskCapabilityRequirementSchema = z.object({
  level: z.number().int().min(0).max(200),
  rationale: NonEmptyLineSchema,
}).strict();
export const TaskDemandSchema = z.object({
  schemaVersion: z.literal(1),
  taskKinds: z.array(TaskKindSchema).min(1).refine((kinds) => new Set(kinds).size === kinds.length, "taskKinds must not contain duplicates"),
  requirements: z.object({
    reasoning: TaskCapabilityRequirementSchema,
    coding: TaskCapabilityRequirementSchema,
    verification: TaskCapabilityRequirementSchema,
    "instruction-fidelity": TaskCapabilityRequirementSchema,
    "tool-use": TaskCapabilityRequirementSchema,
    "long-context": TaskCapabilityRequirementSchema,
    knowledge: TaskCapabilityRequirementSchema,
    "refusal-calibration": TaskCapabilityRequirementSchema,
  }).strict(),
  provenance: z.object({ taskContractRef: NonEmptyLineSchema, headDecisionRef: NonEmptyLineSchema }).strict(),
}).strict();
type TaskDemandSchemaOutput = z.infer<typeof TaskDemandSchema>;
export type TaskDemand = Omit<TaskDemandSchemaOutput, "taskKinds"> & {
  readonly taskKinds: ReadonlyArray<z.infer<typeof TaskKindSchema>>;
};
type AssertFalse<T extends false> = T;
type _TaskDemandTaskKindsMustBeReadonly = AssertFalse<TaskDemand["taskKinds"] extends unknown[] ? true : false>;

const ProviderFactLineListSchema = z.array(NonEmptyLineSchema).min(1).refine((values) => new Set(values).size === values.length, "values must not contain duplicates");
const ProviderFactRetentionSchema = z.enum(["none", "transient", "persistent"]);
const ProviderFactTrainingUseSchema = z.enum(["never", "opt-in", "always"]);
export const ProviderFactsSchema = z.object({
  schemaVersion: z.literal(1),
  contextCapacity: z.number().int().positive(),
  pricing: z.object({ inputPerMillionTokens: z.number().finite().nonnegative(), outputPerMillionTokens: z.number().finite().nonnegative() }).strict(),
  authentication: z.object({ modes: ProviderFactLineListSchema }).strict(),
  dataPolicy: z.object({
    allowedDataClasses: ProviderFactLineListSchema,
    retention: ProviderFactRetentionSchema,
    trainingUse: ProviderFactTrainingUseSchema,
    regions: ProviderFactLineListSchema,
  }).strict(),
  modalities: ProviderFactLineListSchema,
  toolCalls: z.object({ supported: z.boolean() }).strict(),
  provenance: z.object({ source: NonEmptyLineSchema, observedAt: NonEmptyLineSchema }).strict(),
}).strict();
export type ProviderFacts = z.infer<typeof ProviderFactsSchema>;

const OperationalObservationSchema = z.object({
  candidateRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  measuredLatencyMs: z.number().finite().nonnegative(),
  measuredCost: z.number().finite().nonnegative(),
  failureRate: z.number().finite().min(0).max(1),
  timeoutRate: z.number().finite().min(0).max(1),
  providerErrorRate: z.number().finite().min(0).max(1),
  currentAvailability: z.boolean(),
  accountBinding: z.string().min(1).nullable(),
  observedAt: NonEmptyLineSchema,
}).strict().superRefine((value, context) => {
  if (value.currentAvailability && value.accountBinding === null) context.addIssue({ code: "custom", path: ["accountBinding"], message: "available observations require an account binding" });
});
const OperationalObservationListSchema = z.array(OperationalObservationSchema).refine((values) => new Set(values.map((value) => value.candidateRef)).size === values.length, "observations must not duplicate candidateRef");
export const OperationalOverlaySchema = z.object({
  schemaVersion: z.literal(1), installationRef: NonEmptyLineSchema, projectRef: NonEmptyLineSchema, version: z.number().int().positive(), observations: OperationalObservationListSchema,
}).strict();
export type OperationalOverlay = z.infer<typeof OperationalOverlaySchema>;
export const OperationalOverlaySnapshotSchema = z.object({
  schemaVersion: z.literal(1), installationRef: NonEmptyLineSchema, projectRef: NonEmptyLineSchema, goalRef: NonEmptyLineSchema, overlayVersion: z.number().int().positive(), observations: OperationalObservationListSchema,
}).strict();
export type OperationalOverlaySnapshot = z.infer<typeof OperationalOverlaySnapshotSchema>;

export const PressureBandProjectionSchema = z.object({
  pressure: z.number().finite().min(0).max(200),
  band: z.enum(["low", "medium", "high", "critical"]),
  decisionLayer: z.enum(["automatic progress", "Department Head", "Encore Council", "user"]),
}).strict();
export type PressureBandProjection = z.infer<typeof PressureBandProjectionSchema>;

const ModelCapabilityScoreSchema = z.object({
  status: z.enum(["scored", "unproven"]),
  score: z.number().int().min(0).max(200).nullable(),
  rationale: NonEmptyLineSchema,
  evidence: NonEmptyStringListSchema,
}).strict().superRefine((value, context) => {
  if (value.status === "scored" && value.score === null) context.addIssue({ code: "custom", path: ["score"], message: "scored capability requires a score" });
  if (value.status === "unproven" && value.score !== null) context.addIssue({ code: "custom", path: ["score"], message: "unproven capability must have a null score" });
});
const ModelCapabilityVectorSchema = z.object({
  schemaVersion: z.literal(2),
  axes: z.object({
    reasoning: ModelCapabilityScoreSchema, coding: ModelCapabilityScoreSchema, verification: ModelCapabilityScoreSchema,
    "instruction-fidelity": ModelCapabilityScoreSchema, "tool-use": ModelCapabilityScoreSchema, "long-context": ModelCapabilityScoreSchema,
    knowledge: ModelCapabilityScoreSchema, "refusal-calibration": ModelCapabilityScoreSchema,
  }).strict(),
}).strict();
const ModelProfileSchema = z.object({
  modelRef: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  capability: ModelCapabilityVectorSchema,
  providerFacts: ProviderFactsSchema,
  provenance: z.object({ owner: z.literal("human"), sourceRefs: NonEmptyStringListSchema, reviewedAt: NonEmptyLineSchema }).strict(),
}).strict();
const PressureCalculationSchema = z.object({
  pressureFloor: z.number().finite().min(0).max(200),
  pressure: z.number().finite().min(0).max(200),
  explicitHeadUplift: z.number().int().min(0).max(200),
}).strict();
const RoutingRefSchema = z.string().regex(/^\S+$/);
const RoutingCandidateRefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const RoutingApprovalIdentitySchema = z.object({
  capabilityKind: RoutingRefSchema, commandId: RoutingRefSchema, action: RoutingRefSchema, target: RoutingRefSchema,
}).strict();
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
          if (!descriptor || descriptor.enumerable || !("value" in descriptor) || descriptor.value !== value.length) throw new Error("routing evidence array length is invalid");
        } else if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || !descriptor?.enumerable || !("value" in descriptor)) {
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
      if (typeof key !== "string" || !descriptor?.enumerable || !("value" in descriptor)) throw new Error("routing evidence object contains an extra or accessor property");
      assertOrdinaryRoutingShape(descriptor.value, seen);
    }
  } finally {
    seen.delete(value);
  }
}

const RoutingEvidenceHostileShapeGuard = z.unknown().superRefine((value, context) => {
  try { assertOrdinaryRoutingShape(value); } catch (error) { context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "routing evidence shape is invalid" }); }
});

const RoutingEvidencePayloadSchema = z.object({
  schemaVersion: z.literal(1), evidenceId: RoutingRefSchema, goalRef: RoutingRefSchema, projectRef: RoutingRefSchema,
  routeRef: RoutingRefSchema, mode: z.enum(["ensemble", "pin"]), selectedModelRef: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  accountBinding: RoutingRefSchema, candidateRefs: z.array(RoutingCandidateRefSchema).min(1).refine((values) => new Set(values).size === values.length, "candidateRefs must not contain duplicates"),
  selectedCandidateRef: RoutingCandidateRefSchema,
  rejections: z.array(z.object({ candidateRef: NonEmptyLineSchema, reason: NonEmptyLineSchema }).strict()), taskDemandHash: z.string().regex(/^[a-f0-9]{64}$/),
  pressure: z.number().finite().min(0).max(200), pressureBand: z.enum(["low", "medium", "high", "critical"]),
  decisionLayer: z.enum(["automatic progress", "Department Head", "Encore Council", "user"]), overlayVersion: z.number().int().positive(),
  admissionBindingRef: RoutingRefSchema, rationale: NonEmptyLineSchema, createdAt: z.string().datetime(),
  pressureCalculation: PressureCalculationSchema, taskKindRecipeVersions: z.record(z.string().min(1), z.number().int().positive()),
  taskDemand: TaskDemandSchema,
  workCharacter: z.object({
    schemaVersion: z.literal(1), risk: z.number().int().min(0).max(200), reversibility: z.number().int().min(0).max(200), verificationAttachment: z.number().int().min(0).max(200), materialScale: z.number().int().min(0).max(200), timePressure: z.number().int().min(0).max(200), budgetHeadroom: z.number().int().min(0).max(200),
    provenance: z.object({ taskContractRef: NonEmptyLineSchema, headDecisionRef: NonEmptyLineSchema }).strict(),
  }).strict(),
  modelProfile: ModelProfileSchema,
  operationalOverlaySnapshot: OperationalOverlaySnapshotSchema,
  approvalRef: RoutingRefSchema.nullable(), approvalIdentity: RoutingApprovalIdentitySchema.nullable(),
}).strict().superRefine((value, context) => {
  if (!value.candidateRefs.includes(value.selectedCandidateRef)) context.addIssue({ code: "custom", path: ["selectedCandidateRef"], message: "selected candidate must be in candidateRefs" });
  const knownKinds = new Set(["planning", "coding", "verification", "research", "debugging", "tool-operation"]);
  const demandedKinds = new Set<string>(value.taskDemand.taskKinds);
  const recipeKeys = Object.keys(value.taskKindRecipeVersions);
  if (recipeKeys.length !== demandedKinds.size || recipeKeys.some((kind) => !demandedKinds.has(kind) || !knownKinds.has(kind) || value.taskKindRecipeVersions[kind] !== 1)) context.addIssue({ code: "custom", path: ["taskKindRecipeVersions"], message: "recipe versions must exactly match known task kinds" });
  const expectedFloor = (value.workCharacter.risk + (200 - value.workCharacter.reversibility) + value.workCharacter.verificationAttachment) / 3;
  const expectedPressure = Math.max(expectedFloor, value.pressureCalculation.explicitHeadUplift);
  if (value.pressureCalculation.pressureFloor !== expectedFloor || value.pressureCalculation.pressure !== expectedPressure || value.pressure !== expectedPressure) context.addIssue({ code: "custom", path: ["pressureCalculation"], message: "pressure calculation does not match WorkCharacter" });
  const expectedBand = value.pressure < 50 ? "low" : value.pressure < 100 ? "medium" : value.pressure < 150 ? "high" : "critical";
  const expectedLayer = expectedBand === "low" ? "automatic progress" : expectedBand === "medium" ? "Department Head" : expectedBand === "high" ? "Encore Council" : "user";
  if (value.pressureBand !== expectedBand || value.decisionLayer !== expectedLayer) context.addIssue({ code: "custom", path: ["pressureBand"], message: "pressure projection does not match pressure" });
  if (value.taskDemandHash !== taskDemandHash(value.taskDemand)) context.addIssue({ code: "custom", path: ["taskDemandHash"], message: "taskDemandHash does not match taskDemand" });
  const selectedObservation = value.operationalOverlaySnapshot.observations.find((observation) => observation.candidateRef === value.selectedCandidateRef);
  if (selectedObservation === undefined || !selectedObservation.currentAvailability || selectedObservation.accountBinding !== value.accountBinding || value.candidateRefs.some((candidate) => !value.operationalOverlaySnapshot.observations.some((observation) => observation.candidateRef === candidate))) context.addIssue({ code: "custom", path: ["operationalOverlaySnapshot"], message: "candidate set/account binding is not covered by operational observations" });
  if ((value.approvalRef === null) !== (value.approvalIdentity === null)) context.addIssue({ code: "custom", path: ["approvalIdentity"], message: "approvalRef and approvalIdentity must be supplied together" });
  if (value.taskDemand.provenance.taskContractRef !== value.workCharacter.provenance.taskContractRef || value.taskDemand.provenance.headDecisionRef !== value.workCharacter.provenance.headDecisionRef)
    context.addIssue({ code: "custom", path: ["workCharacter", "provenance"], message: "TaskDemand and WorkCharacter provenance must agree" });
  if (value.operationalOverlaySnapshot.projectRef !== value.projectRef || value.operationalOverlaySnapshot.goalRef !== value.goalRef || value.operationalOverlaySnapshot.overlayVersion !== value.overlayVersion)
    context.addIssue({ code: "custom", path: ["operationalOverlaySnapshot"], message: "overlay snapshot identity must match routing evidence" });
  if (value.modelProfile.modelRef !== value.selectedModelRef) context.addIssue({ code: "custom", path: ["modelProfile", "modelRef"], message: "model profile identity must match selected model" });
});
export const RoutingEvidenceSchema = RoutingEvidenceHostileShapeGuard.pipe(RoutingEvidencePayloadSchema);
export type RoutingEvidence = z.infer<typeof RoutingEvidenceSchema>;

export const MissionBundleSubstanceSchema = z.object({
  role: z.enum(["head", "scout", "execution"]), profileRef: z.string().min(1), goalBrief: z.string().min(1),
  taskDemand: TaskDemandSchema, approvedModels: NonEmptyStringListSchema, allowedSkills: NonEmptyStringListSchema, allowedTools: NonEmptyStringListSchema,
  allowedPaths: NonEmptyStringListSchema, environment: NonEmptyStringListSchema, authorityBoundary: NonEmptyStringListSchema,
  externalServiceBoundary: NonEmptyStringListSchema, dataBoundary: NonEmptyStringListSchema, costCeiling: z.string().min(1),
  timeCeiling: z.string().min(1), retryCeiling: z.number().int().nonnegative(), workerCeiling: z.number().int().nonnegative(),
  deliverable: z.string().min(1), evidenceRequirements: NonEmptyStringListSchema, validationCriteria: NonEmptyStringListSchema,
  terminationConditions: NonEmptyStringListSchema,
}).strict();
type MissionBundleSubstanceSchemaOutput = z.infer<typeof MissionBundleSubstanceSchema>;
export type MissionBundleSubstance = Omit<MissionBundleSubstanceSchemaOutput, "taskDemand"> & { readonly taskDemand: TaskDemand };
export const MissionBundleSchema = z.object({
  councilId: UuidSchema, departmentId: z.string().min(1), planVersion: z.number().int().positive(), planContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1), parentRef: z.string().min(1), substance: MissionBundleSubstanceSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type MissionBundleSchemaOutput = z.infer<typeof MissionBundleSchema>;
export type MissionBundle = Omit<MissionBundleSchemaOutput, "substance"> & { readonly substance: MissionBundleSubstance };
export const CreateMissionBundleInputSchema = z.object({ projectId: UuidSchema, substance: MissionBundleSubstanceSchema }).strict();
type CreateMissionBundleInputSchemaOutput = z.infer<typeof CreateMissionBundleInputSchema>;
export type CreateMissionBundleInput = Omit<CreateMissionBundleInputSchemaOutput, "substance"> & { readonly substance: MissionBundleSubstance };

export const WorkerSchema = z.object({
  workerId: UuidSchema, councilId: UuidSchema, departmentId: z.string().min(1), planVersion: z.number().int().positive(), itemId: z.string().min(1),
  bundleContentHash: z.string().regex(/^[a-f0-9]{64}$/), attempt: z.number().int().positive(), executionRef: z.string().min(1), invocationRef: z.string().min(1),
  status: z.enum(["spawned", "running", "succeeded", "failed", "cancelled", "unknown"]), answerText: z.string().nullable(), usageTotalTokens: z.number().int().nonnegative().nullable(),
}).strict();
export type Worker = z.infer<typeof WorkerSchema>;
const WorkerCapabilityJournalEntrySchema = z.object({
  journalId: UuidSchema, capabilityKind: z.string().min(1), projectId: UuidSchema, goalId: UuidSchema,
  approvalId: UuidSchema.optional(), commandId: UuidSchema.optional(),
  event: z.enum(["approval", "rejection", "safer_alternative", "interruption", "effect_result", "failure"]),
  details: z.record(z.string(), z.unknown()), recordedAt: z.string().datetime(),
}).strict();
const WorkerToolEventSchema = z.object({
  ref: z.string().min(1), kind: z.literal("activity"), state: z.enum(["waiting", "writing", "executing"]), toolName: z.string().min(1).optional(),
}).strict();
const WorkerToolEventsSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available"), events: z.array(WorkerToolEventSchema).readonly() }).strict(),
  z.object({ state: z.literal("empty"), events: z.array(z.never()).readonly() }).strict(),
  z.object({ state: z.literal("unavailable"), reason: z.enum(["provider-does-not-expose-tool-events", "snapshot-unavailable"]) }).strict(),
]);
const WorkerIpPythonSessionEventSchema = z.object({
  journalId: UuidSchema, journalPosition: z.string().regex(/^\d+$/), sessionId: z.string().min(1), processRef: z.string().min(1),
  projectId: UuidSchema, goalId: UuidSchema, event: z.enum(["started", "orphaned", "reaped", "completed", "failed", "cancelled", "unknown"]),
  reason: z.string().nullable(), processPid: z.number().int().positive().nullable(), parentPid: z.number().int().positive().nullable(),
  details: z.record(z.string(), z.unknown()), occurredAt: z.string().datetime(),
}).strict();
export const WorkerObservationSchema = WorkerSchema.extend({
  observability: z.object({
    stopState: z.enum(["open", "pause_requested", "paused", "stopping", "stopped", "emergency_stopped"]),
    capabilityJournal: z.array(WorkerCapabilityJournalEntrySchema),
    ipythonSessionJournal: z.array(WorkerIpPythonSessionEventSchema),
    toolEvents: WorkerToolEventsSchema,
  }).strict(),
}).strict();
export type WorkerObservation = z.infer<typeof WorkerObservationSchema>;
export const WorkerListSchema = z.object({ workers: z.array(WorkerSchema) }).strict();
export type WorkerList = z.infer<typeof WorkerListSchema>;
const TargetPathSchema = z.string().min(1).max(4_096);
export const SpawnWorkerInputSchema = z.object({
  projectId: UuidSchema, planVersion: z.number().int().positive(), itemId: z.string().min(1), model: ModelRefSchema.optional(),
  /** Target repository and owned worktree are bound before the provider is admitted. */
  repositoryPath: TargetPathSchema.optional(), worktreePath: TargetPathSchema.optional(),
}).superRefine((value, context) => {
  if ((value.repositoryPath === undefined) !== (value.worktreePath === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: [value.repositoryPath === undefined ? "repositoryPath" : "worktreePath"], message: "repositoryPath and worktreePath must be supplied together" });
}).strict();
export type SpawnWorkerInput = z.infer<typeof SpawnWorkerInputSchema>;
export const WorkerActionInputSchema = z.object({ projectId: UuidSchema }).strict();
export type WorkerActionInput = z.infer<typeof WorkerActionInputSchema>;
export const WorkerMessageInputSchema = z.object({ projectId: UuidSchema, message: z.string().trim().min(1).max(32_000) }).strict();
export type WorkerMessageInput = z.infer<typeof WorkerMessageInputSchema>;
export const FullAccessModeSchema = z.enum(["retain_intermediate_approvals", "skip_intermediate_approvals"]);
export type FullAccessMode = z.infer<typeof FullAccessModeSchema>;
export const CapabilitySessionSelectionInputSchema = z.object({
  projectId: UuidSchema, capabilityKind: z.string().trim().min(1).max(128), sessionId: UuidSchema, fullAccessMode: FullAccessModeSchema,
}).strict();
export type CapabilitySessionSelectionInput = z.infer<typeof CapabilitySessionSelectionInputSchema>;
export const CapabilitySessionSchema = z.object({
  sessionId: UuidSchema, capabilityKind: z.string().min(1), projectId: UuidSchema, goalId: UuidSchema, fullAccessMode: FullAccessModeSchema, selectedBy: z.string().min(1), selectedAt: z.string().datetime(),
}).strict();
export type CapabilitySession = z.infer<typeof CapabilitySessionSchema>;
export const EvidenceCaptureInputSchema = z.object({
  projectId: UuidSchema, correlationId: UuidSchema, commandId: UuidSchema, kind: z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/), mediaType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+(?:;[a-z0-9._-]+=[a-z0-9._-]+)*$/), contentBase64: z.string().min(4).max(4_000_000),
}).strict();
export type EvidenceCaptureInput = z.infer<typeof EvidenceCaptureInputSchema>;
export const EvidenceRecordSchema = z.object({
  evidenceId: UuidSchema, context: z.object({ correlationId: UuidSchema, commandId: UuidSchema, projectId: UuidSchema, goalId: UuidSchema, actorId: z.string().min(1) }).strict(), sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().nonnegative(), kind: z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/), mediaType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+(?:;[a-z0-9._-]+=[a-z0-9._-]+)*$/), createdAt: z.string().datetime(), retention: z.literal("project_lifetime"),
}).strict();
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export const WorkerIntegrationInputSchema = z.object({ projectId: UuidSchema, message: z.string().trim().min(1).max(4_096), evidenceReferences: z.array(z.string().min(1).max(4_096)).max(100).readonly() }).strict();
export type WorkerIntegrationInput = z.infer<typeof WorkerIntegrationInputSchema>;
export const GoalIntegrationBranchInputSchema = z.object({ projectId: UuidSchema, repositoryPath: z.string().min(1), branchName: z.string().min(1), baseRevision: z.string().min(1) }).strict();
export type GoalIntegrationBranchInput = z.infer<typeof GoalIntegrationBranchInputSchema>;
export const DepartmentBranchInputSchema = z.object({ projectId: UuidSchema }).strict();
export type DepartmentBranchInput = z.infer<typeof DepartmentBranchInputSchema>;
export const WorkerWorktreeInputSchema = z.object({ projectId: UuidSchema, worktreePath: z.string().min(1), repositoryPath: z.string().min(1).max(4_096).optional() }).strict();
export type WorkerWorktreeInput = z.infer<typeof WorkerWorktreeInputSchema>;
export const GoalIntegrationRevisionSchema = z.object({ revisionId: UuidSchema, revisionNumber: z.number().int().positive(), goalId: UuidSchema, repositoryPath: z.string().min(1), branchName: z.string().min(1), baseRevision: z.string().min(1), commitSha: z.string().regex(/^[0-9a-f]{40}$/) }).strict();
export type GoalIntegrationRevision = z.infer<typeof GoalIntegrationRevisionSchema>;
export const GoalIntegrationBranchSchema = z.object({ goalId: UuidSchema, repositoryPath: z.string().min(1), branchName: z.string().min(1), baseRevision: z.string().min(1) }).strict();
export type GoalIntegrationBranch = z.infer<typeof GoalIntegrationBranchSchema>;
export const DepartmentBranchSchema = z.object({ goalId: UuidSchema, departmentId: z.string().min(1), repositoryPath: z.string().min(1), branchName: z.string().min(1), baseBranchName: z.string().min(1) }).strict();
export type DepartmentBranch = z.infer<typeof DepartmentBranchSchema>;
export const GoalGitIntegrationStateSchema = z.object({ goalId: UuidSchema, branch: GoalIntegrationBranchSchema.nullable(), latestRevision: GoalIntegrationRevisionSchema.nullable() }).strict();
export type GoalGitIntegrationState = z.infer<typeof GoalGitIntegrationStateSchema>;
export const WorkerWorktreeSchema = z.object({ workerId: UuidSchema, repositoryPath: z.string().min(1), worktreePath: z.string().min(1), branchName: z.string().min(1), baseBranchName: z.string().min(1) }).strict();
export type WorkerWorktree = z.infer<typeof WorkerWorktreeSchema>;
export const IntegrationCommitSchema = z.object({ workerId: UuidSchema, commitSha: z.string().regex(/^[a-f0-9]{40}$/), message: z.string().min(1), evidenceReferences: z.array(z.string().min(1)).readonly() }).strict();
export type IntegrationCommit = z.infer<typeof IntegrationCommitSchema>;
/** CEO approval is explicit, time-bounded, and carries the exact action scope. */
export const CriticalActionApprovalInputSchema = CriticalActionInputSchema.extend({
  expiresAt: z.string().datetime(),
}).strict();
export type CriticalActionApprovalInput = z.infer<typeof CriticalActionApprovalInputSchema>;

/** Only an "allow" decision reaches a 200 response; deny/require_approval map to stable API errors. */
export const CriticalActionResultSchema = z.object({
  goalId: UuidSchema,
  effect: z.literal("allow"),
  reason: z.string().min(1),
  classification: ActionClassificationSchema,
  recordId: UuidSchema.optional(),
}).strict();
export type CriticalActionResult = z.infer<typeof CriticalActionResultSchema>;

export const MetronomeChallengeSchema = z.object({
  challengeId: UuidSchema, goalId: UuidSchema, reason: z.string().min(1), evidenceReferences: z.array(z.string()),
  status: z.enum(["open", "correction_requested", "safe_paused", "resolved"]), correctionRequest: z.string().nullable(),
  raisedBy: z.string().min(1), resolvedBy: z.string().nullable(), resolutionReason: z.string().nullable(),
}).strict();
export type MetronomeChallenge = z.infer<typeof MetronomeChallengeSchema>;
export const MetronomeChallengeListSchema = z.object({ challenges: z.array(MetronomeChallengeSchema) }).strict();
export type MetronomeChallengeList = z.infer<typeof MetronomeChallengeListSchema>;
export const MetronomeFindingSchema = z.object({ findingId: UuidSchema, goalId: UuidSchema, ruleId: z.string().min(1), evidenceIdentity: z.string().min(1), planVersion: z.number().int().positive(), details: z.record(z.string(), z.unknown()), resolved: z.boolean() }).strict();
export const MetronomeFindingListSchema = z.object({ findings: z.array(MetronomeFindingSchema).readonly() }).strict();
export type MetronomeFindingList = z.infer<typeof MetronomeFindingListSchema>;
export const MetronomeScanInputSchema = z.object({ projectId: UuidSchema }).strict();
export type MetronomeScanInput = z.infer<typeof MetronomeScanInputSchema>;
export const RaiseMetronomeChallengeInputSchema = z.object({ projectId: UuidSchema, findingIds: z.array(UuidSchema), reason: z.string().min(1), evidenceReferences: z.array(z.string().min(1)) }).strict();
export type RaiseMetronomeChallengeInput = z.infer<typeof RaiseMetronomeChallengeInputSchema>;
export const MetronomeCorrectionInputSchema = z.object({ projectId: UuidSchema, correctionRequest: z.string().min(1) }).strict();
export type MetronomeCorrectionInput = z.infer<typeof MetronomeCorrectionInputSchema>;
export const MetronomeSafePauseInputSchema = z.object({ projectId: UuidSchema }).strict();
export type MetronomeSafePauseInput = z.infer<typeof MetronomeSafePauseInputSchema>;
export const MetronomeResolutionInputSchema = z.object({ projectId: UuidSchema, reason: z.string().min(1) }).strict();
export type MetronomeResolutionInput = z.infer<typeof MetronomeResolutionInputSchema>;

const CouncilJudgmentSchema = z.object({ modelProvider: z.string().min(1), modelId: z.string().min(1), verdict: z.enum(["proceed", "do_not_proceed", "escalate"]), confidence: z.enum(["low", "medium", "high"]), reasoning: z.string().min(1), conditions: z.array(z.string()), dissentNote: z.string().nullable(), citedEvidenceIds: z.array(z.string()) }).strict();
const CouncilSynthesisSchema = z.object({ finalVerdict: z.enum(["proceed", "do_not_proceed", "escalate"]), sameModelOnly: z.boolean(), escalated: z.boolean(), dissentNotes: z.array(z.string()).readonly() }).strict();
export const EncoreCouncilRoundListSchema = z.object({ rounds: z.array(z.object({ roundId: UuidSchema, goalId: UuidSchema, question: z.string().min(1), criteria: z.array(z.object({ criterionId: z.string(), description: z.string() }).strict()), evidenceIds: z.array(z.string()), triggerReasons: z.array(z.string()), reviewerCount: z.number().int().positive(), judgments: z.array(CouncilJudgmentSchema), synthesis: CouncilSynthesisSchema }).strict()) }).strict();
export type EncoreCouncilRoundList = z.infer<typeof EncoreCouncilRoundListSchema>;
export const EncoreReviewInputSchema = z.object({ projectId: UuidSchema, question: z.string().min(1), criteria: z.array(z.object({ criterionId: z.string().min(1), description: z.string().min(1) }).strict()).min(1), evidenceIds: z.array(z.string().min(1)), reviewerCount: z.number().int().min(1).max(8) }).strict();
export type EncoreReviewInput = z.infer<typeof EncoreReviewInputSchema>;
const EncoreResultJudgmentSchema = z.object({ modelProvider: z.string().min(1), modelId: z.string().min(1), verdict: z.enum(["proceed", "do_not_proceed", "escalate"]), confidence: z.enum(["low", "medium", "high"]), reasoning: z.string().min(1), conditions: z.array(z.string()).readonly(), dissentNote: z.string().nullable(), citedEvidenceIds: z.array(z.string()).readonly() }).strict();
export const EncoreCouncilResultSchema = z.object({ roundId: UuidSchema, judgments: z.array(EncoreResultJudgmentSchema).readonly(), synthesis: CouncilSynthesisSchema }).strict();
export type EncoreCouncilResult = z.infer<typeof EncoreCouncilResultSchema>;

export const CertificationSchema = z.object({ certificationId: UuidSchema, kind: z.enum(["quality", "security", "safety_compliance"]), goalId: UuidSchema, contractId: UuidSchema, contractVersion: z.number().int(), contractContentHash: z.string().min(1), integratedCommitSha: z.string().min(1), workerId: UuidSchema, departmentAcceptanceId: UuidSchema, integrationRevisionId: UuidSchema, verdict: z.enum(["passed", "failed", "blocked"]), certifiedByDepartment: z.string().min(1), producingDepartment: z.string().min(1) }).strict();
export type Certification = z.infer<typeof CertificationSchema>;
export const CertificationListSchema = z.object({ certifications: z.array(CertificationSchema) }).strict();
export type CertificationList = z.infer<typeof CertificationListSchema>;
export const DepartmentAcceptanceSchema = z.object({ acceptanceId: UuidSchema, workerId: UuidSchema, commitSha: z.string().regex(/^[0-9a-f]{40}$/), reason: z.string().min(1), acceptedBy: z.string().min(1) }).strict();
export type DepartmentAcceptance = z.infer<typeof DepartmentAcceptanceSchema>;
const QualityFindingSchema = z.object({ findingId: z.string().min(1), severity: z.enum(["critical", "noncritical"]), description: z.string().min(1) }).strict();
export const QualityCertificationSubstanceSchema = z.object({ verdict: z.enum(["passed", "failed", "blocked"]), findings: z.array(QualityFindingSchema), testEvidenceIds: z.array(z.string().min(1)) }).strict();
export type QualityCertificationSubstance = z.infer<typeof QualityCertificationSubstanceSchema>;
export const AcceptWorkerInputSchema = z.object({ projectId: UuidSchema, reason: z.string().min(1) }).strict();
export type AcceptWorkerInput = z.infer<typeof AcceptWorkerInputSchema>;
export const CertifyWorkerInputSchema = z.object({ projectId: UuidSchema, certifyingDepartmentId: z.string().min(1), substance: QualityCertificationSubstanceSchema }).strict();
export type CertifyWorkerInput = z.infer<typeof CertifyWorkerInputSchema>;

const ConcertmasterFinalReportSchema = z.object({ reportId: UuidSchema, goalId: UuidSchema, success: z.boolean(), blockers: z.array(z.object({ reason: z.string(), detail: z.string() }).strict()), ceoRequest: z.string(), whatChanged: z.string(), userVisibleBehaviorPassed: z.boolean(), participatingDepartments: z.array(z.string()), keyDecisions: z.array(z.string()), dissent: z.array(z.string()), independentValidation: z.array(z.string()), costCents: z.number().int(), budgetCents: z.number().int(), incidents: z.array(z.string()), knownLimitations: z.array(z.string()), criticalActionAwaitingApproval: z.boolean(), evidenceBundleId: UuidSchema }).strict();
export { ConcertmasterFinalReportSchema };
export type ConcertmasterFinalReport = z.infer<typeof ConcertmasterFinalReportSchema>;
export const EvidenceBundleReadSchema = z.object({ bundleId: UuidSchema, goalId: UuidSchema, content: z.record(z.string(), z.unknown()), hash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type EvidenceBundleRead = z.infer<typeof EvidenceBundleReadSchema>;

export const ImprovementDigestMetricSchema = z.object({ name: z.string().min(1), value: z.number().finite(), unit: z.string().min(1) }).strict();
export const ImprovementDigestSourceRefSchema = z.object({
  kind: z.enum(["goal", "evidence_record", "evidence_bundle", "metronome_finding", "discord_improvement_evidence", "encore_round"]),
  sourceId: z.string().min(1),
}).strict();
export const ImprovementDigestSchema = z.object({
  digestId: UuidSchema, schemaVersion: z.literal(1), projectId: UuidSchema, goalId: UuidSchema, episodeId: z.string().min(1),
  trigger: z.enum(["worker_completed", "worker_failed", "worker_cancelled", "department_handoff", "council_decision", "goal_completed", "goal_failed", "goal_rollback", "incident_closed", "cost_threshold", "quality_signal"]),
  situation: z.string().min(1), selectedDecision: z.string().min(1), rejectedAlternatives: z.array(z.string()),
  observedResult: z.string().min(1), metrics: z.array(ImprovementDigestMetricSchema), confidence: z.number().min(0).max(1),
  sourceRefs: z.array(ImprovementDigestSourceRefSchema), contentHash: z.string().min(1), authorId: z.string().min(1), sessionRef: z.string().min(1), createdAt: z.string().min(1),
}).strict();
export type ImprovementDigest = z.infer<typeof ImprovementDigestSchema>;
export const ImprovementDigestListSchema = z.object({ digests: z.array(ImprovementDigestSchema) }).strict();
export type ImprovementDigestList = z.infer<typeof ImprovementDigestListSchema>;

export const DiscordSignalSchema = z.object({
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
}).strict();
export const AuthenticatedDiscordSignalSchema = z.object({
  signal: DiscordSignalSchema, nonce: z.string().min(1), sequence: z.number().int(), issuedAt: z.string().min(1), signature: z.string().min(1),
}).strict();
export type AuthenticatedDiscordSignal = z.infer<typeof AuthenticatedDiscordSignalSchema>;
export const StoredDiscordSignalSchema = z.object({
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
  signalId: UuidSchema, nonce: z.string().min(1), sequence: z.number().int(), issuedAt: z.string().min(1), signature: z.string().min(1), receivedAt: z.string().min(1),
}).strict();
export type StoredDiscordSignal = z.infer<typeof StoredDiscordSignalSchema>;
