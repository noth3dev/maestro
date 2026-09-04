import { z } from "zod";

export const UuidSchema = z.uuid();
export const CommandVersionSchema = z.number().int().min(0);

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

export const StableApiErrorCodeSchema = z.enum([
  "validation_error", "version_conflict", "invalid_transition", "goal_not_found",
  "stale_lease", "lease_unavailable", "command_id_reused", "durable_store_unavailable",
  "authentication_required", "authentication_unavailable", "credential_forbidden",
  "critical_action_denied", "critical_action_requires_approval", "project_access_forbidden",
  "task_contract_not_found", "task_contract_conflict", "task_contract_version_conflict",
  "exact_confirmation_required", "task_contract_integrity_error",
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

/** Body for the single critical-action gateway call site (Phase 1 exit gate). */
export const CriticalActionInputSchema = z.object({
  projectId: UuidSchema,
  action: z.string().min(1),
  target: z.string().min(1),
  policyVersion: z.number().int().min(0),
  budgetEffectCents: z.number().int(),
}).strict();
export type CriticalActionInput = z.infer<typeof CriticalActionInputSchema>;

/** Only an "allow" decision reaches a 200 response; deny/require_approval map to stable API errors. */
export const CriticalActionResultSchema = z.object({
  goalId: UuidSchema,
  effect: z.literal("allow"),
  reason: z.string().min(1),
  classification: ActionClassificationSchema,
  recordId: UuidSchema.optional(),
}).strict();
export type CriticalActionResult = z.infer<typeof CriticalActionResultSchema>;

const MetronomeChallengeSchema = z.object({
  challengeId: UuidSchema, goalId: UuidSchema, reason: z.string().min(1), evidenceReferences: z.array(z.string()),
  status: z.enum(["open", "correction_requested", "safe_paused", "resolved"]), correctionRequest: z.string().nullable(),
  raisedBy: z.string().min(1), resolvedBy: z.string().nullable(), resolutionReason: z.string().nullable(),
}).strict();
export const MetronomeChallengeListSchema = z.object({ challenges: z.array(MetronomeChallengeSchema) }).strict();
export type MetronomeChallengeList = z.infer<typeof MetronomeChallengeListSchema>;

const CouncilJudgmentSchema = z.object({ modelProvider: z.string().min(1), modelId: z.string().min(1), verdict: z.enum(["proceed", "do_not_proceed", "escalate"]), confidence: z.enum(["low", "medium", "high"]), reasoning: z.string().min(1), conditions: z.array(z.string()), dissentNote: z.string().nullable(), citedEvidenceIds: z.array(z.string()) }).strict();
const CouncilSynthesisSchema = z.object({ finalVerdict: z.enum(["proceed", "do_not_proceed", "escalate"]), sameModelOnly: z.boolean(), escalated: z.boolean(), dissentNotes: z.array(z.string()) }).strict();
export const EncoreCouncilRoundListSchema = z.object({ rounds: z.array(z.object({ roundId: UuidSchema, goalId: UuidSchema, question: z.string().min(1), criteria: z.array(z.object({ criterionId: z.string(), description: z.string() }).strict()), evidenceIds: z.array(z.string()), triggerReasons: z.array(z.string()), reviewerCount: z.number().int().positive(), judgments: z.array(CouncilJudgmentSchema), synthesis: CouncilSynthesisSchema }).strict()) }).strict();
export type EncoreCouncilRoundList = z.infer<typeof EncoreCouncilRoundListSchema>;

const CertificationSchema = z.object({ certificationId: UuidSchema, kind: z.enum(["quality", "security", "safety_compliance"]), goalId: UuidSchema, contractId: UuidSchema, contractVersion: z.number().int(), contractContentHash: z.string().min(1), integratedCommitSha: z.string().min(1), workerId: UuidSchema, departmentAcceptanceId: UuidSchema, integrationRevisionId: UuidSchema, verdict: z.enum(["passed", "failed", "blocked"]), certifiedByDepartment: z.string().min(1), producingDepartment: z.string().min(1) }).strict();
export const CertificationListSchema = z.object({ certifications: z.array(CertificationSchema) }).strict();
export type CertificationList = z.infer<typeof CertificationListSchema>;

const ConcertmasterFinalReportSchema = z.object({ reportId: UuidSchema, goalId: UuidSchema, success: z.boolean(), blockers: z.array(z.object({ reason: z.string(), detail: z.string() }).strict()), ceoRequest: z.string(), whatChanged: z.string(), userVisibleBehaviorPassed: z.boolean(), participatingDepartments: z.array(z.string()), keyDecisions: z.array(z.string()), dissent: z.array(z.string()), independentValidation: z.array(z.string()), costCents: z.number().int(), budgetCents: z.number().int(), incidents: z.array(z.string()), knownLimitations: z.array(z.string()), criticalActionAwaitingApproval: z.boolean(), evidenceBundleId: UuidSchema }).strict();
export { ConcertmasterFinalReportSchema };
export type ConcertmasterFinalReport = z.infer<typeof ConcertmasterFinalReportSchema>;
