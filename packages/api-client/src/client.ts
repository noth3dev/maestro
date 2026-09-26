import type { MethodContext } from "./context.js";
import { ApiError } from "./errors.js";
import type { Fetch } from "./transport.js";
import { createGoalsMethods } from "./methods/goals.js";
import { createTaskContractsMethods } from "./methods/task-contracts.js";
import { createReadsMethods } from "./methods/reads.js";
import { createCatalogMethods } from "./methods/catalog.js";
import { createProvidersMethods } from "./methods/providers.js";
import { createConversationsMethods } from "./methods/conversations.js";
import { createEffectsMethods } from "./methods/effects.js";
import { createCouncilsMethods } from "./methods/councils.js";
import { createPlanningMethods } from "./methods/planning.js";
import { createWorkersMethods } from "./methods/workers.js";
import { createGitMethods } from "./methods/git.js";
import { createCertificationMethods } from "./methods/certification.js";
import { createOversightMethods } from "./methods/oversight.js";
import { createReportingMethods } from "./methods/reporting.js";
import { createEventsMethods } from "./methods/events.js";
import { createRouterMethods } from "./methods/router.js";
import { createOvertureMethods } from "./methods/overture.js";
import {
  GoalResultSchema,
  type MetronomeChallengeList,
  type EncoreCouncilRoundList,
  type CertificationList,
  type ConcertmasterFinalReport,
  type EvidenceBundleRead,
  type GoalGitIntegrationState,
  type WorkerList,
  type ImprovementDigestList,
  type ArrangementsRead,
  type PersonaInspection,
  type PersonaReadQuery,
  type PersonaProposalInput,
  type ImprovementCandidate,
  StableApiErrorSchema,
  GoalControlInputSchema,
  UuidSchema,
  type CreateGoalInput,
  type CreateTaskContractInput,
  type TaskContract,
  type TaskContractLaunchResult,
  type TaskContractConfirmationInput,
  type TaskContractQuery,
  type UpdateTaskContractInput,
  type OvertureSelectionInput,
  type OvertureRoleSelectionResult,
  type EventQuery,
  type GoalEventPage,
  type GoalEvent,
  type GoalQuery,
  type GoalList,
  type ProjectList,
  type OrganizationReadModel,
  type ChannelSelector,
  type ChannelQuery,
  type ChannelMessageInput,
  type ChannelMessage,
  type ChannelRead,
  type ProjectionQuery,
  type ProjectionReadModel,
  type Conversation,
  type CreateConversationInput,
  type ConversationTurnInput,
  type ConversationTurnResult,
  type ConversationEvent,
  type ConversationActivityEvent,
  type ConversationEventQuery,
  type CreateOvertureRunBody,
  type AppendOvertureOperatorMessageBody,
  type OvertureRun,
  type OvertureMessage,
  type OvertureEvent,
  type OvertureRunQuery,
  type OvertureEventQuery,
  type ModelCatalogEntry,
  type ProviderCredentialLoginInput,
  type ProviderCredentialBinding,
  type ProviderAccountLoginStartResult,
  type ProviderAccountLoginStatus,
  type GoalBudgetSummary,
  type BillingReadModel,
  type GoalResult,
  type StartGoalOrchestrationStatus,
  type CriticalActionInput,
  type CriticalActionApprovalInput,
  type CriticalActionResult,
  type InboxRead,
  type HeadParticipationInput,
  type HeadParticipation,
  type CreateHeadCouncilInput,
  type SubmitCouncilBriefInput,
  type HeadCouncilDecisionInput,
  type HeadCouncil,
  type CreateDepartmentPlanInput,
  type DepartmentPlan,
  type ReviseDepartmentPlanInput,
  type CreateMissionBundleInput,
  type MissionBundle,
  type SpawnWorkerInput,
  type Worker,
  type WorkerObservation,
  type WorkerActionInput,
  type WorkerMessageInput,
  type WorkerIntegrationInput,
  type IntegrationCommit,
  type GoalIntegrationBranchInput,
  type GoalIntegrationBranch,
  type GoalIntegrationRevision,
  type DepartmentBranchInput,
  type DepartmentBranch,
  type WorkerWorktreeInput,
  type WorkerWorktree,
  type AcceptWorkerInput,
  type DepartmentAcceptance,
  type CertifyWorkerInput,
  type Certification,
  type MetronomeScanInput,
  type MetronomeCorrectionInput,
  type MetronomeSafePauseInput,
  type MetronomeResolutionInput,
  type MetronomeFindingList,
  type RaiseMetronomeChallengeInput,
  type MetronomeChallenge,
  type EncoreReviewInput,
  type EncoreCouncilResult,
  type TransitionGoalInput,
  type ProjectAccessProvisionInput,
  type ProjectAccessProvisionResult,
  type GoalControlInput,
  type CapabilitySessionSelectionInput,
  type CapabilitySession,
  type EvidenceCaptureInput,
  type EvidenceRecord,
  type SettingsRead,
  type SettingsPreferencesUpdate,
  type SettingsModelPoolUpdate,
  type SettingsAuthorityDefaultsUpdate,
  type RouterCatalogRead,
  type RouterConfigInput,
  type RouterConfigValidation,
} from "@maestro/contracts";

export interface ApiClient {
  createGoal(input: CreateGoalInput, commandId: string): Promise<GoalResult>;
  createTaskContract(input: CreateTaskContractInput, contractId: string): Promise<TaskContract>;
  getTaskContract(contractId: string, query: TaskContractQuery): Promise<TaskContract>;
  updateTaskContract(contractId: string, input: UpdateTaskContractInput, commandId?: string): Promise<TaskContract>;
  selectOvertureRoles(contractId: string, input: OvertureSelectionInput, commandId?: string): Promise<OvertureRoleSelectionResult>;
  confirmTaskContract(contractId: string, input: TaskContractConfirmationInput, commandId?: string): Promise<void>;
  launchTaskContract(contractId: string, projectId: string, commandId?: string): Promise<TaskContractLaunchResult>;
  listGoals(projectId: string): Promise<GoalList>;
  listInbox(projectId: string): Promise<InboxRead>;
  listProjects(): Promise<ProjectList>;
  getOrganization(): Promise<OrganizationReadModel>;
  getChannel(goalId: string, selector: ChannelSelector, query: ChannelQuery): Promise<ChannelRead>;
  postChannelMessage(goalId: string, selector: ChannelSelector, input: ChannelMessageInput, commandId?: string): Promise<ChannelMessage>;
  getProjection(query: ProjectionQuery): Promise<ProjectionReadModel>;
  listModels(): Promise<readonly ModelCatalogEntry[]>;
  getSettings(): Promise<SettingsRead>;
  updateSettingsPreferences(patch: SettingsPreferencesUpdate): Promise<SettingsRead>;
  updateSettingsModelPool(patch: SettingsModelPoolUpdate): Promise<SettingsRead>;
  updateSettingsAuthorityDefaults(patch: SettingsAuthorityDefaultsUpdate): Promise<SettingsRead>;
  getRouterCatalog(): Promise<RouterCatalogRead>;
  validateRouterConfig(input: RouterConfigInput): Promise<RouterConfigValidation>;
  replaceRouterConfig(input: RouterConfigInput): Promise<RouterCatalogRead>;
  listProviderConnections(): Promise<
    readonly { providerId: string; connected: boolean; authModes: readonly ("api-key" | "managed-subscription")[] }[]
  >;
  loginProvider(input: ProviderCredentialLoginInput): Promise<ProviderCredentialBinding>;
  logoutProvider(providerId: "openai" | "anthropic"): Promise<void>;
  startAccountLogin(providerId: "openai-codex" | "anthropic-claude"): Promise<ProviderAccountLoginStartResult>;
  accountLoginStatus(providerId: "openai-codex" | "anthropic-claude", loginId: string): Promise<ProviderAccountLoginStatus>;
  cancelAccountLogin(providerId: "openai-codex" | "anthropic-claude", loginId: string): Promise<void>;
  logoutAccount(providerId: "openai-codex" | "anthropic-claude"): Promise<void>;
  createConversation(input: CreateConversationInput, options?: { idempotencyKey?: string }): Promise<Conversation>;
  getConversation(conversationId: string, query: GoalQuery): Promise<Conversation>;
  listSessionWorkspaceFiles(conversationId: string, query: GoalQuery): Promise<import("@maestro/contracts").SessionWorkspaceListing>;
  readSessionWorkspaceFile(conversationId: string, query: import("@maestro/contracts").SessionWorkspaceFileQuery): Promise<import("@maestro/contracts").SessionWorkspaceFile>;
  listConversations(query: import("@maestro/contracts").ConversationListQuery): Promise<readonly import("@maestro/contracts").ConversationSummary[]>;
  sendConversationTurn(
    conversationId: string,
    input: ConversationTurnInput,
    options?: { signal?: AbortSignal; idempotencyKey?: string },
  ): Promise<ConversationTurnResult>;
  cancelConversation(conversationId: string, query: GoalQuery): Promise<Conversation>;
  listConversationEvents(conversationId: string, query: ConversationEventQuery): Promise<readonly ConversationEvent[]>;
  streamConversationEvents(
    conversationId: string,
    query: ConversationEventQuery,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<ConversationEvent>;
  streamConversationActivity(
    conversationId: string,
    query: GoalQuery,
    options?: { signal?: AbortSignal; onConnected?: () => void },
  ): AsyncIterable<ConversationActivityEvent>;
  createOvertureRun(input: CreateOvertureRunBody, options?: { idempotencyKey?: string }): Promise<OvertureRun>;
  getOvertureRun(runId: string, query: OvertureRunQuery): Promise<OvertureRun>;
  listOvertureRuns(query: OvertureRunQuery): Promise<readonly OvertureRun[]>;
  sendOvertureOperatorMessage(
    runId: string,
    input: AppendOvertureOperatorMessageBody,
    options?: { idempotencyKey?: string },
  ): Promise<OvertureMessage>;
  listOvertureMessages(runId: string, query: OvertureEventQuery): Promise<readonly OvertureMessage[]>;
  listOvertureArtifacts(runId: string, query: OvertureRunQuery): Promise<readonly import("@maestro/contracts").OvertureArtifact[]>;
  getOverturePlanManifest(runId: string, query: OvertureRunQuery): Promise<import("@maestro/contracts").OverturePlanManifest>;
  reviseOverturePlan(
    runId: string,
    documentId: string,
    input: import("@maestro/contracts").ReviseOverturePlanBody,
    options?: { idempotencyKey?: string },
  ): Promise<import("@maestro/contracts").OverturePlanDocument>;
  openOvertureClarification(
    runId: string,
    input: import("@maestro/contracts").OpenOvertureClarificationBody,
    options?: { idempotencyKey?: string },
  ): Promise<import("@maestro/contracts").OvertureClarification>;
  answerOvertureClarification(
    runId: string,
    clarificationId: string,
    input: import("@maestro/contracts").AnswerOvertureClarificationBody,
    options?: { idempotencyKey?: string },
  ): Promise<import("@maestro/contracts").OvertureClarification>;
  createOvertureTaskContract(
    runId: string,
    input: import("@maestro/contracts").CreateOvertureTaskContractBody,
    options?: { idempotencyKey?: string },
  ): Promise<import("@maestro/contracts").TaskContract>;
  listOvertureEvents(runId: string, query: OvertureEventQuery): Promise<readonly OvertureEvent[]>;
  streamOvertureEvents(runId: string, query: OvertureEventQuery, options?: { signal?: AbortSignal }): AsyncIterable<OvertureEvent>;
  provisionProjectAccess(input: ProjectAccessProvisionInput): Promise<ProjectAccessProvisionResult>;
  getGoal(goalId: string, query: GoalQuery): Promise<GoalResult>;
  getGoalOrchestrationStatus(goalId: string, query: GoalQuery): Promise<StartGoalOrchestrationStatus>;
  transitionGoal(goalId: string, input: TransitionGoalInput, commandId: string): Promise<GoalResult>;
  pauseGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  stopGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  resumeGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  emergencyStopGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  requestCriticalAction(goalId: string, input: CriticalActionInput, commandId: string): Promise<CriticalActionResult>;
  approveAndRunCriticalAction(goalId: string, input: CriticalActionApprovalInput, commandId: string): Promise<CriticalActionResult>;
  denyCriticalAction(goalId: string, input: CriticalActionInput, commandId: string): Promise<void>;
  selectFullAccessMode(goalId: string, input: CapabilitySessionSelectionInput): Promise<CapabilitySession>;
  captureEvidence(goalId: string, input: EvidenceCaptureInput): Promise<EvidenceRecord>;
  activateHead(goalId: string, input: HeadParticipationInput, commandId: string): Promise<HeadParticipation>;
  createCouncil(goalId: string, input: CreateHeadCouncilInput, commandId: string): Promise<HeadCouncil>;
  getCouncil(councilId: string, projectId: string): Promise<HeadCouncil>;
  submitCouncilBrief(councilId: string, departmentId: string, input: SubmitCouncilBriefInput, commandId: string): Promise<void>;
  revealCouncil(councilId: string, projectId: string, commandId: string): Promise<void>;
  decideCouncil(councilId: string, input: HeadCouncilDecisionInput, commandId: string): Promise<HeadCouncil>;
  createDepartmentPlan(
    councilId: string,
    departmentId: string,
    input: CreateDepartmentPlanInput,
    commandId: string,
  ): Promise<DepartmentPlan>;
  getDepartmentPlan(councilId: string, departmentId: string, projectId: string): Promise<DepartmentPlan>;
  reviseDepartmentPlan(
    councilId: string,
    departmentId: string,
    input: ReviseDepartmentPlanInput,
    commandId: string,
  ): Promise<DepartmentPlan>;
  createMissionBundle(
    councilId: string,
    departmentId: string,
    itemId: string,
    input: CreateMissionBundleInput,
    commandId: string,
  ): Promise<MissionBundle>;
  getMissionBundle(councilId: string, departmentId: string, planVersion: number, itemId: string, projectId: string): Promise<MissionBundle>;
  spawnWorker(councilId: string, departmentId: string, input: SpawnWorkerInput, commandId: string): Promise<Worker>;
  getWorker(workerId: string, projectId: string): Promise<Worker>;
  observeWorker(workerId: string, input: WorkerActionInput, commandId: string): Promise<WorkerObservation>;
  sendWorkerMessage(workerId: string, input: WorkerMessageInput, commandId: string): Promise<Worker>;
  cancelWorker(workerId: string, input: WorkerActionInput, commandId: string): Promise<Worker>;
  createGoalIntegrationBranch(goalId: string, input: GoalIntegrationBranchInput, commandId: string): Promise<GoalIntegrationBranch>;
  freezeGoalIntegrationRevision(goalId: string, input: DepartmentBranchInput, commandId: string): Promise<GoalIntegrationRevision>;
  createDepartmentBranch(
    councilId: string,
    departmentId: string,
    input: DepartmentBranchInput,
    commandId: string,
  ): Promise<DepartmentBranch>;
  createWorkerWorktree(workerId: string, input: WorkerWorktreeInput, commandId: string): Promise<WorkerWorktree>;
  advanceWorkerIntegration(workerId: string, input: WorkerIntegrationInput, commandId: string): Promise<IntegrationCommit>;
  acceptWorker(workerId: string, input: AcceptWorkerInput, commandId: string): Promise<DepartmentAcceptance>;
  certifyWorker(workerId: string, input: CertifyWorkerInput, commandId: string): Promise<Certification>;
  certifyConditionalWorker(
    workerId: string,
    kind: "security" | "safety_compliance",
    input: CertifyWorkerInput,
    commandId: string,
  ): Promise<Certification>;
  scanMetronome(goalId: string, input: MetronomeScanInput, commandId: string): Promise<MetronomeFindingList>;
  raiseMetronomeChallenge(goalId: string, input: RaiseMetronomeChallengeInput, commandId: string): Promise<MetronomeChallenge>;
  requestMetronomeCorrection(challengeId: string, input: MetronomeCorrectionInput, commandId: string): Promise<MetronomeChallenge>;
  requestMetronomeSafePause(
    goalId: string,
    challengeId: string,
    input: MetronomeSafePauseInput,
    commandId: string,
  ): Promise<MetronomeChallenge>;
  resolveMetronomeChallenge(challengeId: string, input: MetronomeResolutionInput, commandId: string): Promise<MetronomeChallenge>;
  runEncoreReview(goalId: string, input: EncoreReviewInput, commandId: string): Promise<EncoreCouncilResult>;
  getBudgetSummary(goalId: string, query: GoalQuery): Promise<GoalBudgetSummary>;
  getBillingSummary(projectId: string): Promise<BillingReadModel>;
  listEvents(query: EventQuery): Promise<GoalEventPage>;
  streamEvents(query: EventQuery, options?: { signal?: AbortSignal; onConnected?: () => void }): AsyncIterable<GoalEvent>;
  listMetronomeChallenges(goalId: string, query: GoalQuery): Promise<MetronomeChallengeList>;
  listEncoreCouncilRounds(goalId: string, query: GoalQuery): Promise<EncoreCouncilRoundList>;
  listCertifications(goalId: string, query: GoalQuery): Promise<CertificationList>;
  generateConcertmasterReport(goalId: string, query: GoalQuery, commandId: string): Promise<ConcertmasterFinalReport>;
  getConcertmasterReport(goalId: string, query: GoalQuery): Promise<ConcertmasterFinalReport>;
  getEvidenceBundle(goalId: string, query: GoalQuery): Promise<EvidenceBundleRead>;
  getEvidenceDump(
    goalId: string,
    query: GoalQuery,
  ): Promise<{ bundle: EvidenceBundleRead; certifications: CertificationList; report: ConcertmasterFinalReport }>;
  getGitIntegrationState(goalId: string, query: GoalQuery): Promise<GoalGitIntegrationState>;
  listWorkersForGoal(goalId: string, query: GoalQuery): Promise<WorkerList>;
  listImprovementDigestsForGoal(goalId: string, query: GoalQuery): Promise<ImprovementDigestList>;
  getArrangements(goalId: string, query: GoalQuery): Promise<ArrangementsRead>;
  getPersona(query: PersonaReadQuery): Promise<PersonaInspection>;
  proposePersona(input: PersonaProposalInput, commandId: string): Promise<ImprovementCandidate>;
  editPersonaCandidate(candidateId: string, input: PersonaProposalInput, commandId: string): Promise<ImprovementCandidate>;
}

export function createApiClient({
  baseUrl,
  token,
  fetch = globalThis.fetch,
  timeoutMs = 30_000,
  signal,
}: {
  baseUrl: string;
  token: string;
  fetch?: Fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}): ApiClient {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const loopback = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "::1";
  if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))
    throw new Error("Control plane URL must use HTTPS unless it is loopback");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive safe integer");
  const request = async <T>(path: string, init: RequestInit, parse: { parse(value: unknown): T }): Promise<T> => {
    const controller = new AbortController();
    const requestSignal = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(new URL(path, base).href, { ...init, signal: requestSignal, redirect: "error" });
    } catch {
      clearTimeout(timer);
      throw new Error("Control plane request failed");
    }
    const body: unknown = await response.json().catch(() => undefined);
    clearTimeout(timer);
    if (!response.ok) {
      const stable = StableApiErrorSchema.safeParse(body);
      if (stable.success) throw new ApiError(response.status, stable.data.error.code, stable.data.error.message, stable.data.error.detail);
      throw new Error(`Control plane returned HTTP ${response.status}`);
    }
    return parse.parse(body);
  };
  const headers = { authorization: `Bearer ${token}` };
  const controlGoal = (
    goalId: string,
    input: GoalControlInput,
    commandId: string,
    action: "pause" | "stop" | "resume" | "emergency-stop",
  ) => {
    const parsedGoalId = UuidSchema.parse(goalId);
    return request(
      `v1/goals/${encodeURIComponent(parsedGoalId)}/${action}`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(GoalControlInputSchema.parse(input)),
      },
      GoalResultSchema,
    );
  };

  const ctx: MethodContext = { request, headers, controlGoal, fetch, base };
  return {
    ...createGoalsMethods(ctx),
    ...createTaskContractsMethods(ctx),
    ...createReadsMethods(ctx),
    ...createCatalogMethods(ctx),
    ...createProvidersMethods(ctx),
    ...createConversationsMethods(ctx),
    ...createOvertureMethods(ctx),
    ...createEffectsMethods(ctx),
    ...createCouncilsMethods(ctx),
    ...createPlanningMethods(ctx),
    ...createWorkersMethods(ctx),
    ...createGitMethods(ctx),
    ...createCertificationMethods(ctx),
    ...createOversightMethods(ctx),
    ...createReportingMethods(ctx),
    ...createEventsMethods(ctx),
    ...createRouterMethods(ctx),
  };
}
