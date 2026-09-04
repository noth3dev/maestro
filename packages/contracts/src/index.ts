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
  "critical_action_denied", "authority_denied", "critical_action_requires_approval", "critical_action_approval_forbidden", "head_activation_cycle", "head_activation_conflict", "council_not_found", "council_conflict", "council_briefs_sealed", "department_plan_not_found", "department_plan_conflict", "mission_bundle_not_found", "mission_bundle_conflict", "worker_not_found", "worker_conflict", "git_integration_not_found", "git_integration_conflict", "certification_not_found", "certification_conflict", "metronome_not_found", "metronome_conflict", "encore_not_found", "encore_conflict", "project_access_forbidden",
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

export const MissionBundleSubstanceSchema = z.object({
  role: z.enum(["head", "scout", "execution"]), profileRef: z.string().min(1), goalBrief: z.string().min(1),
  approvedModels: NonEmptyStringListSchema, allowedSkills: NonEmptyStringListSchema, allowedTools: NonEmptyStringListSchema,
  allowedPaths: NonEmptyStringListSchema, environment: NonEmptyStringListSchema, authorityBoundary: NonEmptyStringListSchema,
  externalServiceBoundary: NonEmptyStringListSchema, dataBoundary: NonEmptyStringListSchema, costCeiling: z.string().min(1),
  timeCeiling: z.string().min(1), retryCeiling: z.number().int().nonnegative(), workerCeiling: z.number().int().nonnegative(),
  deliverable: z.string().min(1), evidenceRequirements: NonEmptyStringListSchema, validationCriteria: NonEmptyStringListSchema,
  terminationConditions: NonEmptyStringListSchema,
}).strict();
export type MissionBundleSubstance = z.infer<typeof MissionBundleSubstanceSchema>;
export const MissionBundleSchema = z.object({
  councilId: UuidSchema, departmentId: z.string().min(1), planVersion: z.number().int().positive(), planContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1), parentRef: z.string().min(1), substance: MissionBundleSubstanceSchema, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type MissionBundle = z.infer<typeof MissionBundleSchema>;
export const CreateMissionBundleInputSchema = z.object({ projectId: UuidSchema, substance: MissionBundleSubstanceSchema }).strict();
export type CreateMissionBundleInput = z.infer<typeof CreateMissionBundleInputSchema>;

export const WorkerSchema = z.object({
  workerId: UuidSchema, councilId: UuidSchema, departmentId: z.string().min(1), planVersion: z.number().int().positive(), itemId: z.string().min(1),
  bundleContentHash: z.string().regex(/^[a-f0-9]{64}$/), attempt: z.number().int().positive(), executionRef: z.string().min(1), invocationRef: z.string().min(1),
  status: z.enum(["spawned", "running", "succeeded", "failed", "cancelled", "unknown"]), answerText: z.string().nullable(), usageTotalTokens: z.number().int().nonnegative().nullable(),
}).strict();
export type Worker = z.infer<typeof WorkerSchema>;
export const SpawnWorkerInputSchema = z.object({ projectId: UuidSchema, planVersion: z.number().int().positive(), itemId: z.string().min(1) }).strict();
export type SpawnWorkerInput = z.infer<typeof SpawnWorkerInputSchema>;
export const WorkerActionInputSchema = z.object({ projectId: UuidSchema }).strict();
export type WorkerActionInput = z.infer<typeof WorkerActionInputSchema>;
export const GoalIntegrationBranchInputSchema = z.object({ projectId: UuidSchema, repositoryPath: z.string().min(1), branchName: z.string().min(1), baseRevision: z.string().min(1) }).strict();
export type GoalIntegrationBranchInput = z.infer<typeof GoalIntegrationBranchInputSchema>;
export const DepartmentBranchInputSchema = z.object({ projectId: UuidSchema }).strict();
export type DepartmentBranchInput = z.infer<typeof DepartmentBranchInputSchema>;
export const WorkerWorktreeInputSchema = z.object({ projectId: UuidSchema, worktreePath: z.string().min(1) }).strict();
export type WorkerWorktreeInput = z.infer<typeof WorkerWorktreeInputSchema>;
export const GoalIntegrationRevisionSchema = z.object({ revisionId: UuidSchema, revisionNumber: z.number().int().positive(), goalId: UuidSchema, repositoryPath: z.string().min(1), branchName: z.string().min(1), baseRevision: z.string().min(1), commitSha: z.string().regex(/^[0-9a-f]{40}$/) }).strict();
export type GoalIntegrationRevision = z.infer<typeof GoalIntegrationRevisionSchema>;
export const GoalIntegrationBranchSchema = z.object({ goalId: UuidSchema, repositoryPath: z.string().min(1), branchName: z.string().min(1), baseRevision: z.string().min(1) }).strict();
export type GoalIntegrationBranch = z.infer<typeof GoalIntegrationBranchSchema>;
export const DepartmentBranchSchema = z.object({ goalId: UuidSchema, departmentId: z.string().min(1), repositoryPath: z.string().min(1), branchName: z.string().min(1), baseBranchName: z.string().min(1) }).strict();
export type DepartmentBranch = z.infer<typeof DepartmentBranchSchema>;
export const WorkerWorktreeSchema = z.object({ workerId: UuidSchema, repositoryPath: z.string().min(1), worktreePath: z.string().min(1), branchName: z.string().min(1), baseBranchName: z.string().min(1) }).strict();
export type WorkerWorktree = z.infer<typeof WorkerWorktreeSchema>;
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
