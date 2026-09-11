import {
  CreateGoalInputSchema,
  CreateTaskContractInputSchema,
  TaskContractConfirmationInputSchema,
  TaskContractQuerySchema,
  TaskContractSchema,
  UpdateTaskContractInputSchema,
  OvertureSelectionInputSchema,
  OvertureRoleSelectionResultSchema,
  EventQuerySchema,
  GoalEventPageSchema,
  GoalEventSchema,
  GoalQuerySchema,
  GoalListSchema,
  ProjectListSchema,
  ConversationSchema,
  CreateConversationInputSchema,
  ConversationTurnInputSchema,
  ConversationTurnResultSchema,
  ConversationEventQuerySchema,
  ConversationEventSchema,
  ModelCatalogEntrySchema,
  ProviderCredentialLoginInputSchema,
  ProviderCredentialBindingSchema,
  ProviderAccountLoginStartInputSchema,
  ProviderAccountLoginStartResultSchema,
  ProviderAccountLoginStatusSchema,
  GoalBudgetSummarySchema,
  GoalResultSchema,
  CriticalActionInputSchema,
  CriticalActionApprovalInputSchema,
  CriticalActionResultSchema,
  HeadParticipationInputSchema,
  HeadParticipationSchema,
  CreateHeadCouncilInputSchema,
  SubmitCouncilBriefInputSchema,
  HeadCouncilDecisionInputSchema,
  HeadCouncilSchema,
  CreateDepartmentPlanInputSchema,
  DepartmentPlanSchema,
  ReviseDepartmentPlanInputSchema,
  CreateMissionBundleInputSchema,
  MissionBundleSchema,
  SpawnWorkerInputSchema,
  WorkerSchema,
  WorkerObservationSchema,
  WorkerActionInputSchema,
  WorkerMessageInputSchema,
  WorkerIntegrationInputSchema,
  IntegrationCommitSchema,
  GoalIntegrationBranchInputSchema,
  GoalIntegrationBranchSchema,
  GoalIntegrationRevisionSchema,
  DepartmentBranchSchema,
  DepartmentBranchInputSchema,
  WorkerWorktreeSchema,
  WorkerWorktreeInputSchema,
  AcceptWorkerInputSchema,
  DepartmentAcceptanceSchema,
  CertifyWorkerInputSchema,
  CertificationSchema,
  MetronomeScanInputSchema,
  MetronomeCorrectionInputSchema,
  MetronomeSafePauseInputSchema,
  MetronomeResolutionInputSchema,
  MetronomeFindingListSchema,
  RaiseMetronomeChallengeInputSchema,
  MetronomeChallengeSchema,
  EncoreReviewInputSchema,
  EncoreCouncilResultSchema,
  MetronomeChallengeListSchema, EncoreCouncilRoundListSchema, CertificationListSchema, ConcertmasterFinalReportSchema, EvidenceBundleReadSchema,
  type MetronomeChallengeList, type EncoreCouncilRoundList, type CertificationList, type ConcertmasterFinalReport, type EvidenceBundleRead,
  GoalGitIntegrationStateSchema, type GoalGitIntegrationState,
  WorkerListSchema, type WorkerList,
  ImprovementDigestListSchema, type ImprovementDigestList,
  StableApiErrorSchema,
  ProjectAccessProvisionInputSchema,
  ProjectAccessProvisionResultSchema,
  TransitionGoalInputSchema,
  GoalControlInputSchema,
  CapabilitySessionSelectionInputSchema,
  CapabilitySessionSchema,
  EvidenceCaptureInputSchema,
  EvidenceRecordSchema,
  UuidSchema,
  type CreateGoalInput,
  type CreateTaskContractInput,
  type TaskContract,
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
  type Conversation,
  type CreateConversationInput,
  type ConversationTurnInput,
  type ConversationTurnResult,
  type ConversationEvent,
  type ConversationEventQuery,
  type ModelCatalogEntry,
  type ProviderCredentialLoginInput,
  type ProviderCredentialBinding,
  type ProviderAccountLoginStartResult,
  type ProviderAccountLoginStatus,
  type GoalBudgetSummary,
  type GoalResult,
  type CriticalActionInput,
  type CriticalActionApprovalInput,
  type CriticalActionResult,
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
  type StableApiError,
  type TransitionGoalInput,
  type ProjectAccessProvisionInput,
  type ProjectAccessProvisionResult,
  type GoalControlInput,
  type CapabilitySessionSelectionInput,
  type CapabilitySession,
  type EvidenceCaptureInput,
  type EvidenceRecord,
} from "@maestro/contracts";

export class ApiError extends Error {
  readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: StableApiError["error"]["code"],
    message: string,
  ) {
    super(message);
  }
}

export interface ApiClient {
  createGoal(input: CreateGoalInput, commandId: string): Promise<GoalResult>;
  createTaskContract(input: CreateTaskContractInput, contractId: string): Promise<TaskContract>;
  getTaskContract(contractId: string, query: TaskContractQuery): Promise<TaskContract>;
  updateTaskContract(contractId: string, input: UpdateTaskContractInput, commandId?: string): Promise<TaskContract>;
  selectOvertureRoles(contractId: string, input: OvertureSelectionInput, commandId?: string): Promise<OvertureRoleSelectionResult>;
  confirmTaskContract(contractId: string, input: TaskContractConfirmationInput, commandId?: string): Promise<void>;
  launchTaskContract(contractId: string, projectId: string, commandId?: string): Promise<TaskContract>;
  listGoals(projectId: string): Promise<GoalList>;
  listProjects(): Promise<ProjectList>;
  listModels(): Promise<readonly ModelCatalogEntry[]>;
  loginProvider(input: ProviderCredentialLoginInput): Promise<ProviderCredentialBinding>;
  logoutProvider(providerId: "openai" | "anthropic"): Promise<void>;
  startAccountLogin(): Promise<ProviderAccountLoginStartResult>;
  accountLoginStatus(loginId: string): Promise<ProviderAccountLoginStatus>;
  cancelAccountLogin(loginId: string): Promise<void>;
  logoutAccount(): Promise<void>;
  createConversation(input: CreateConversationInput, options?: { idempotencyKey?: string }): Promise<Conversation>;
  getConversation(conversationId: string, query: GoalQuery): Promise<Conversation>;
  sendConversationTurn(conversationId: string, input: ConversationTurnInput, options?: { signal?: AbortSignal; idempotencyKey?: string }): Promise<ConversationTurnResult>;
  cancelConversation(conversationId: string, query: GoalQuery): Promise<Conversation>;
  listConversationEvents(conversationId: string, query: ConversationEventQuery): Promise<readonly ConversationEvent[]>;
  streamConversationEvents(conversationId: string, query: ConversationEventQuery, options?: { signal?: AbortSignal }): AsyncIterable<ConversationEvent>;
  provisionProjectAccess(input: ProjectAccessProvisionInput): Promise<ProjectAccessProvisionResult>;
  getGoal(goalId: string, query: GoalQuery): Promise<GoalResult>;
  transitionGoal(goalId: string, input: TransitionGoalInput, commandId: string): Promise<GoalResult>;
  pauseGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  stopGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  resumeGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  emergencyStopGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  requestCriticalAction(goalId: string, input: CriticalActionInput, commandId: string): Promise<CriticalActionResult>;
  approveAndRunCriticalAction(goalId: string, input: CriticalActionApprovalInput, commandId: string): Promise<CriticalActionResult>;
  selectFullAccessMode(goalId: string, input: CapabilitySessionSelectionInput): Promise<CapabilitySession>;
  captureEvidence(goalId: string, input: EvidenceCaptureInput): Promise<EvidenceRecord>;
  activateHead(goalId: string, input: HeadParticipationInput, commandId: string): Promise<HeadParticipation>;
  createCouncil(goalId: string, input: CreateHeadCouncilInput, commandId: string): Promise<HeadCouncil>;
  getCouncil(councilId: string, projectId: string): Promise<HeadCouncil>;
  submitCouncilBrief(councilId: string, departmentId: string, input: SubmitCouncilBriefInput, commandId: string): Promise<void>;
  revealCouncil(councilId: string, projectId: string, commandId: string): Promise<void>;
  decideCouncil(councilId: string, input: HeadCouncilDecisionInput, commandId: string): Promise<HeadCouncil>;
  createDepartmentPlan(councilId: string, departmentId: string, input: CreateDepartmentPlanInput, commandId: string): Promise<DepartmentPlan>;
  getDepartmentPlan(councilId: string, departmentId: string, projectId: string): Promise<DepartmentPlan>;
  reviseDepartmentPlan(councilId: string, departmentId: string, input: ReviseDepartmentPlanInput, commandId: string): Promise<DepartmentPlan>;
  createMissionBundle(councilId: string, departmentId: string, itemId: string, input: CreateMissionBundleInput, commandId: string): Promise<MissionBundle>;
  getMissionBundle(councilId: string, departmentId: string, planVersion: number, itemId: string, projectId: string): Promise<MissionBundle>;
  spawnWorker(councilId: string, departmentId: string, input: SpawnWorkerInput, commandId: string): Promise<Worker>;
  getWorker(workerId: string, projectId: string): Promise<Worker>;
  observeWorker(workerId: string, input: WorkerActionInput, commandId: string): Promise<WorkerObservation>;
  sendWorkerMessage(workerId: string, input: WorkerMessageInput, commandId: string): Promise<Worker>;
  cancelWorker(workerId: string, input: WorkerActionInput, commandId: string): Promise<Worker>;
  createGoalIntegrationBranch(goalId: string, input: GoalIntegrationBranchInput, commandId: string): Promise<GoalIntegrationBranch>;
  freezeGoalIntegrationRevision(goalId: string, input: DepartmentBranchInput, commandId: string): Promise<GoalIntegrationRevision>;
  createDepartmentBranch(councilId: string, departmentId: string, input: DepartmentBranchInput, commandId: string): Promise<DepartmentBranch>;
  createWorkerWorktree(workerId: string, input: WorkerWorktreeInput, commandId: string): Promise<WorkerWorktree>;
  advanceWorkerIntegration(workerId: string, input: WorkerIntegrationInput, commandId: string): Promise<IntegrationCommit>;
  acceptWorker(workerId: string, input: AcceptWorkerInput, commandId: string): Promise<DepartmentAcceptance>;
  certifyWorker(workerId: string, input: CertifyWorkerInput, commandId: string): Promise<Certification>;
  certifyConditionalWorker(workerId: string, kind: "security" | "safety_compliance", input: CertifyWorkerInput, commandId: string): Promise<Certification>;
  scanMetronome(goalId: string, input: MetronomeScanInput, commandId: string): Promise<MetronomeFindingList>;
  raiseMetronomeChallenge(goalId: string, input: RaiseMetronomeChallengeInput, commandId: string): Promise<MetronomeChallenge>;
  requestMetronomeCorrection(challengeId: string, input: MetronomeCorrectionInput, commandId: string): Promise<MetronomeChallenge>;
  requestMetronomeSafePause(goalId: string, challengeId: string, input: MetronomeSafePauseInput, commandId: string): Promise<MetronomeChallenge>;
  resolveMetronomeChallenge(challengeId: string, input: MetronomeResolutionInput, commandId: string): Promise<MetronomeChallenge>;
  runEncoreReview(goalId: string, input: EncoreReviewInput, commandId: string): Promise<EncoreCouncilResult>;
  getBudgetSummary(goalId: string, query: GoalQuery): Promise<GoalBudgetSummary>;
  listEvents(query: EventQuery): Promise<GoalEventPage>;
  streamEvents(query: EventQuery, options?: { signal?: AbortSignal }): AsyncIterable<GoalEvent>;
  listMetronomeChallenges(goalId: string, query: GoalQuery): Promise<MetronomeChallengeList>;
  listEncoreCouncilRounds(goalId: string, query: GoalQuery): Promise<EncoreCouncilRoundList>;
  listCertifications(goalId: string, query: GoalQuery): Promise<CertificationList>;
  generateConcertmasterReport(goalId: string, query: GoalQuery, commandId: string): Promise<ConcertmasterFinalReport>;
  getConcertmasterReport(goalId: string, query: GoalQuery): Promise<ConcertmasterFinalReport>;
  getEvidenceBundle(goalId: string, query: GoalQuery): Promise<EvidenceBundleRead>;
  getGitIntegrationState(goalId: string, query: GoalQuery): Promise<GoalGitIntegrationState>;
  listWorkersForGoal(goalId: string, query: GoalQuery): Promise<WorkerList>;
  listImprovementDigestsForGoal(goalId: string, query: GoalQuery): Promise<ImprovementDigestList>;
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function cryptoRandomUuid(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  throw new Error("Secure random UUID generation is unavailable");
}

async function* readEventStream(fetch: Fetch, base: URL, headers: Record<string, string>, query: EventQuery, signal?: AbortSignal): AsyncGenerator<GoalEvent> {
  const parsed = EventQuerySchema.parse(query);
  const url = new URL("v1/events/stream", base);
  url.search = new URLSearchParams({ projectId: parsed.projectId, after: parsed.after }).toString();
  let response: Response;
  try {
    response = await fetch(url.href, { headers: { ...headers, "last-event-id": parsed.after }, redirect: "error", ...(signal === undefined ? {} : { signal }) });
  } catch {
    throw new Error("Control plane event stream failed");
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const stable = StableApiErrorSchema.safeParse(body);
    if (stable.success) throw new ApiError(response.status, stable.data.error.code, stable.data.error.message);
    throw new Error(`Control plane event stream returned HTTP ${response.status}`);
  }
  if (response.body === null) throw new Error("Control plane event stream returned no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const records = buffer.split(/\r?\n\r?\n/);
      buffer = records.pop() ?? "";
      for (const record of records) {
        const eventName = record.match(/^event:\s*(.+)$/m)?.[1];
        const data = record.match(/^data:\s*(.+)$/m)?.[1];
        if (eventName !== "goal-event" || data === undefined) continue;
        yield GoalEventSchema.parse(JSON.parse(data));
      }
      if (chunk.done) break;
    }
    if (buffer.trim() !== "") {
      const eventName = buffer.match(/^event:\s*(.+)$/m)?.[1];
      const data = buffer.match(/^data:\s*(.+)$/m)?.[1];
      if (eventName === "goal-event" && data !== undefined) yield GoalEventSchema.parse(JSON.parse(data));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const MAX_CONVERSATION_STREAM_RECORD_BYTES = 128_000;

async function* readConversationEventStream(fetch: Fetch, base: URL, headers: Record<string, string>, conversationId: string, query: ConversationEventQuery, signal?: AbortSignal): AsyncGenerator<ConversationEvent> {
  const parsed = ConversationEventQuerySchema.parse(query);
  const url = new URL(`v1/conversations/${encodeURIComponent(conversationId)}/events/stream`, base);
  url.search = new URLSearchParams({ projectId: parsed.projectId, after: parsed.after }).toString();
  let response: Response;
  try { response = await fetch(url.href, { headers: { ...headers, "last-event-id": parsed.after }, redirect: "error", ...(signal === undefined ? {} : { signal }) }); }
  catch { throw new Error("Control plane conversation stream failed"); }
  if (!response.ok) throw new Error(`Control plane conversation stream returned HTTP ${response.status}`);
  if (response.body === null) throw new Error("Control plane conversation stream returned no body");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() ?? "";
      if (Buffer.byteLength(buffer, "utf8") > MAX_CONVERSATION_STREAM_RECORD_BYTES) throw new Error("Control plane conversation stream record is too large");
      for (const record of records) {
        if (Buffer.byteLength(record, "utf8") > MAX_CONVERSATION_STREAM_RECORD_BYTES) throw new Error("Control plane conversation stream record is too large");
        if (record.match(/^event:\s*(.+)$/m)?.[1] !== "conversation-event") continue;
        const data = record.match(/^data:\s*(.+)$/m)?.[1]; if (data !== undefined) yield ConversationEventSchema.parse(JSON.parse(data));
      }
      if (chunk.done) break;
    }
    if (buffer.trim() !== "") {
      if (Buffer.byteLength(buffer, "utf8") > MAX_CONVERSATION_STREAM_RECORD_BYTES) throw new Error("Control plane conversation stream record is too large");
      if (buffer.match(/^event:\s*(.+)$/m)?.[1] === "conversation-event") {
        const data = buffer.match(/^data:\s*(.+)$/m)?.[1];
        if (data !== undefined) yield ConversationEventSchema.parse(JSON.parse(data));
      }
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

export function createApiClient({ baseUrl, token, fetch = globalThis.fetch, timeoutMs = 30_000, signal }: { baseUrl: string; token: string; fetch?: Fetch; timeoutMs?: number; signal?: AbortSignal }): ApiClient {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const loopback = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "::1";
  if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) throw new Error("Control plane URL must use HTTPS unless it is loopback");
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
      if (stable.success) throw new ApiError(response.status, stable.data.error.code, stable.data.error.message);
      throw new Error(`Control plane returned HTTP ${response.status}`);
    }
    return parse.parse(body);
  };
  const headers = { authorization: `Bearer ${token}` };
  const controlGoal = (goalId: string, input: GoalControlInput, commandId: string, action: "pause" | "stop" | "resume" | "emergency-stop") => {
    const parsedGoalId = UuidSchema.parse(goalId);
    return request(`v1/goals/${encodeURIComponent(parsedGoalId)}/${action}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
      body: JSON.stringify(GoalControlInputSchema.parse(input)),
    }, GoalResultSchema);
  };

  return {
    createGoal(input, commandId) {
      return request("v1/goals", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(CreateGoalInputSchema.parse(input)),
      }, GoalResultSchema);
    },
    createTaskContract(input, contractId) {
      return request("v1/task-contracts", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(contractId) },
        body: JSON.stringify(CreateTaskContractInputSchema.parse(input)),
      }, TaskContractSchema);
    },
    getTaskContract(contractId, query) {
      const parsedQuery = TaskContractQuerySchema.parse(query);
      return request(`v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}?${new URLSearchParams({ projectId: parsedQuery.projectId })}`, { headers }, TaskContractSchema);
    },
    updateTaskContract(contractId, input, commandId = contractId) {
      return request(`v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(UpdateTaskContractInputSchema.parse(input)),
      }, TaskContractSchema);
    },
    selectOvertureRoles(contractId, input, commandId = contractId) {
      return request(`v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}/overture-selection`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(OvertureSelectionInputSchema.parse(input)),
      }, OvertureRoleSelectionResultSchema);
    },
    confirmTaskContract(contractId, input, commandId = contractId) {
      return request(`v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}/confirmation`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(TaskContractConfirmationInputSchema.parse(input)),
      }, { parse: () => undefined });
    },
    launchTaskContract(contractId, projectId, commandId = contractId) {
      const parsedProjectId = UuidSchema.parse(projectId);
      return request(`v1/task-contracts/${encodeURIComponent(UuidSchema.parse(contractId))}/launch`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify({ projectId: parsedProjectId }),
      }, TaskContractSchema);
    },
    listGoals(projectId) {
      const parsedProjectId = UuidSchema.parse(projectId);
      return request(`v1/goals?${new URLSearchParams({ projectId: parsedProjectId })}`, { headers }, GoalListSchema);
    },
    listProjects() {
      return request("v1/projects", { headers }, ProjectListSchema);
    },
    listModels() {
      return request("v1/models", { headers }, { parse(body: unknown) {
        if (!Array.isArray(body)) throw new Error("Control plane returned malformed model catalog");
        return body.map((item) => ModelCatalogEntrySchema.parse(item));
      } });
    },
    loginProvider(input) {
      const parsed = ProviderCredentialLoginInputSchema.parse(input);
      return request("v1/provider-credentials", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() },
        body: JSON.stringify(parsed),
      }, ProviderCredentialBindingSchema);
    },
    logoutProvider(providerId) {
      if (providerId !== "openai" && providerId !== "anthropic") throw new Error("Invalid provider");
      return request(`v1/provider-credentials/${encodeURIComponent(providerId)}`, {
        method: "DELETE",
        headers: { ...headers, "idempotency-key": cryptoRandomUuid() },
      }, { parse: () => undefined });
    },
    startAccountLogin() {
      const input = ProviderAccountLoginStartInputSchema.parse({ providerId: "openai-codex" });
      return request("v1/provider-account-logins/start", {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() }, body: JSON.stringify(input),
      }, ProviderAccountLoginStartResultSchema);
    },
    accountLoginStatus(loginId) {
      if (typeof loginId !== "string" || loginId.trim() === "") throw new Error("Invalid login session");
      return request("v1/provider-account-logins/status", {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() }, body: JSON.stringify({ providerId: "openai-codex", loginId }),
      }, ProviderAccountLoginStatusSchema);
    },
    cancelAccountLogin(loginId) {
      if (typeof loginId !== "string" || loginId.trim() === "") throw new Error("Invalid login session");
      return request("v1/provider-account-logins/cancel", {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() }, body: JSON.stringify({ providerId: "openai-codex", loginId }),
      }, { parse: () => undefined });
    },
    logoutAccount() {
      return request("v1/provider-account-logins/logout", {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": cryptoRandomUuid() }, body: JSON.stringify({ providerId: "openai-codex" }),
      }, { parse(value) {
        if (!value || typeof value !== "object" || (value as { revoked?: unknown }).revoked !== true) throw new Error("Control Plane returned malformed account logout");
        return undefined;
      } });
    },
    createConversation(input, options) {
      return request("v1/conversations", { method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": options?.idempotencyKey === undefined ? cryptoRandomUuid() : UuidSchema.parse(options.idempotencyKey) }, body: JSON.stringify(CreateConversationInputSchema.parse(input)) }, ConversationSchema);
    },
    getConversation(conversationId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, ConversationSchema);
    },
    sendConversationTurn(conversationId, input, options) {
      return request(`v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}/turns`, { method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": options?.idempotencyKey === undefined ? cryptoRandomUuid() : UuidSchema.parse(options.idempotencyKey) }, body: JSON.stringify(ConversationTurnInputSchema.parse(input)), ...(options?.signal === undefined ? {} : { signal: options.signal }) }, ConversationTurnResultSchema);
    },
    cancelConversation(conversationId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}/cancel`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(parsed) }, ConversationSchema);
    },
    listConversationEvents(conversationId, query) {
      const parsed = ConversationEventQuerySchema.parse(query);
      return request(`v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}/events?${new URLSearchParams({ projectId: parsed.projectId, after: parsed.after }).toString()}`, { headers }, ConversationEventSchema.array());
    },
    streamConversationEvents(conversationId, query, options) {
      return readConversationEventStream(fetch, base, headers, UuidSchema.parse(conversationId), query, options?.signal);
    },
    provisionProjectAccess(input) {
      return request("v1/admin/project-access", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(ProjectAccessProvisionInputSchema.parse(input)),
      }, ProjectAccessProvisionResultSchema);
    },
    getGoal(goalId, query) {
      const parsedGoalId = UuidSchema.parse(goalId);
      const parsedQuery = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(parsedGoalId)}?${new URLSearchParams({ projectId: parsedQuery.projectId })}`, { headers }, GoalResultSchema);
    },
    getBudgetSummary(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/budget?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, GoalBudgetSummarySchema);
    },
    transitionGoal(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/transitions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(TransitionGoalInputSchema.parse(input)),
      }, GoalResultSchema);
    },
    pauseGoal(goalId, input, commandId) {
      return controlGoal(goalId, input, commandId, "pause");
    },
    stopGoal(goalId, input, commandId) {
      return controlGoal(goalId, input, commandId, "stop");
    },
    resumeGoal(goalId, input, commandId) {
      return controlGoal(goalId, input, commandId, "resume");
    },
    emergencyStopGoal(goalId, input, commandId) {
      return controlGoal(goalId, input, commandId, "emergency-stop");
    },
    requestCriticalAction(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/critical-actions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(CriticalActionInputSchema.parse(input)),
      }, CriticalActionResultSchema);
    },
    approveAndRunCriticalAction(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/critical-actions/approve-and-run`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(CriticalActionApprovalInputSchema.parse(input)),
      }, CriticalActionResultSchema);
    },
    selectFullAccessMode(goalId, input) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/capabilities/full-access-mode`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(CapabilitySessionSelectionInputSchema.parse(input)),
      }, CapabilitySessionSchema);
    },
    captureEvidence(goalId, input) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/evidence-records`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(EvidenceCaptureInputSchema.parse(input)),
      }, EvidenceRecordSchema);
    },
    activateHead(goalId, input, commandId) {
      const parsedGoalId = UuidSchema.parse(goalId);
      return request(`v1/goals/${encodeURIComponent(parsedGoalId)}/head-participations`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(HeadParticipationInputSchema.parse(input)),
      }, HeadParticipationSchema);
    },
    createCouncil(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/councils`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(CreateHeadCouncilInputSchema.parse(input)),
      }, HeadCouncilSchema);
    },
    getCouncil(councilId, projectId) {
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}?${new URLSearchParams({ projectId: UuidSchema.parse(projectId) })}`, { headers }, HeadCouncilSchema);
    },
    submitCouncilBrief(councilId, departmentId, input, commandId) {
      const parsedCouncilId = UuidSchema.parse(councilId);
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(`v1/councils/${encodeURIComponent(parsedCouncilId)}/briefs/${encodeURIComponent(departmentId)}`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(SubmitCouncilBriefInputSchema.parse(input)),
      }, { parse: () => undefined });
    },
    revealCouncil(councilId, projectId, commandId) {
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/reveal`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify({ projectId: UuidSchema.parse(projectId) }),
      }, { parse: () => undefined });
    },
    decideCouncil(councilId, input, commandId) {
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/decision`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(HeadCouncilDecisionInputSchema.parse(input)),
      }, HeadCouncilSchema);
    },
    createDepartmentPlan(councilId, departmentId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/plan`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(CreateDepartmentPlanInputSchema.parse(input)),
      }, DepartmentPlanSchema);
    },
    getDepartmentPlan(councilId, departmentId, projectId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/plan?${new URLSearchParams({ projectId: UuidSchema.parse(projectId) })}`, { headers }, DepartmentPlanSchema);
    },
    reviseDepartmentPlan(councilId, departmentId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/plan`, {
        method: "PUT", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(ReviseDepartmentPlanInputSchema.parse(input)),
      }, DepartmentPlanSchema);
    },
    createMissionBundle(councilId, departmentId, itemId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId) || !/^[A-Za-z0-9._:-]+$/.test(itemId)) throw new Error("Invalid mission bundle identity");
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/mission-bundles/${encodeURIComponent(itemId)}`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(CreateMissionBundleInputSchema.parse(input)),
      }, MissionBundleSchema);
    },
    getMissionBundle(councilId, departmentId, planVersion, itemId, projectId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId) || !/^[A-Za-z0-9._:-]+$/.test(itemId) || !Number.isSafeInteger(planVersion) || planVersion < 1) throw new Error("Invalid mission bundle identity");
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/mission-bundles/${encodeURIComponent(itemId)}?${new URLSearchParams({ projectId: UuidSchema.parse(projectId), planVersion: String(planVersion) })}`, { headers }, MissionBundleSchema);
    },
    spawnWorker(councilId, departmentId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/workers`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(SpawnWorkerInputSchema.parse(input)),
      }, WorkerSchema);
    },
    getWorker(workerId, projectId) {
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}?${new URLSearchParams({ projectId: UuidSchema.parse(projectId) })}`, { headers }, WorkerSchema);
    },
    observeWorker(workerId, input, commandId) {
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/observe`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(WorkerActionInputSchema.parse(input)),
      }, WorkerObservationSchema);
    },
    sendWorkerMessage(workerId, input, commandId) {
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/messages`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(WorkerMessageInputSchema.parse(input)),
      }, WorkerSchema);
    },
    cancelWorker(workerId, input, commandId) {
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/cancel`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(WorkerActionInputSchema.parse(input)),
      }, WorkerSchema);
    },
    createGoalIntegrationBranch(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/git/integration-branch`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(GoalIntegrationBranchInputSchema.parse(input)),
      }, GoalIntegrationBranchSchema);
    },
    freezeGoalIntegrationRevision(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/git/integration-revision`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(DepartmentBranchInputSchema.parse(input)),
      }, GoalIntegrationRevisionSchema);
    },
    createDepartmentBranch(councilId, departmentId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(`v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/git/branch`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(DepartmentBranchInputSchema.parse(input)),
      }, DepartmentBranchSchema);
    },
    createWorkerWorktree(workerId, input, commandId) {
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/git/worktree`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(WorkerWorktreeInputSchema.parse(input)),
      }, WorkerWorktreeSchema);
    },
    advanceWorkerIntegration(workerId, input, commandId) {
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/git/advance`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(WorkerIntegrationInputSchema.parse(input)),
      }, IntegrationCommitSchema);
    },
    acceptWorker(workerId, input, commandId) {
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/accept`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(AcceptWorkerInputSchema.parse(input)),
      }, DepartmentAcceptanceSchema);
    },
    certifyWorker(workerId, input, commandId) {
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/certifications/quality`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(CertifyWorkerInputSchema.parse(input)),
      }, CertificationSchema);
    },
    certifyConditionalWorker(workerId, kind, input, commandId) {
      if (kind !== "security" && kind !== "safety_compliance") throw new Error("Invalid conditional certification kind");
      return request(`v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/certifications/${kind}`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(CertifyWorkerInputSchema.parse(input)),
      }, CertificationSchema);
    },
    scanMetronome(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/metronome/scan`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(MetronomeScanInputSchema.parse(input)),
      }, MetronomeFindingListSchema);
    },
    raiseMetronomeChallenge(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/metronome/challenges`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(RaiseMetronomeChallengeInputSchema.parse(input)),
      }, MetronomeChallengeSchema);
    },
    requestMetronomeCorrection(challengeId, input, commandId) {
      const parsedChallengeId = UuidSchema.parse(challengeId);
      return request(`v1/metronome/challenges/${encodeURIComponent(parsedChallengeId)}/correction`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(MetronomeCorrectionInputSchema.parse(input)),
      }, MetronomeChallengeSchema);
    },
    requestMetronomeSafePause(goalId, challengeId, input, commandId) {
      const parsedGoalId = UuidSchema.parse(goalId);
      const parsedChallengeId = UuidSchema.parse(challengeId);
      return request(`v1/goals/${encodeURIComponent(parsedGoalId)}/metronome/challenges/${encodeURIComponent(parsedChallengeId)}/safe-pause`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(MetronomeSafePauseInputSchema.parse(input)),
      }, MetronomeChallengeSchema);
    },
    resolveMetronomeChallenge(challengeId, input, commandId) {
      const parsedChallengeId = UuidSchema.parse(challengeId);
      return request(`v1/metronome/challenges/${encodeURIComponent(parsedChallengeId)}/resolve`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(MetronomeResolutionInputSchema.parse(input)),
      }, MetronomeChallengeSchema);
    },
    runEncoreReview(goalId, input, commandId) {
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/encore/reviews`, {
        method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) }, body: JSON.stringify(EncoreReviewInputSchema.parse(input)),
      }, EncoreCouncilResultSchema);
    },
    listMetronomeChallenges(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/metronome-challenges?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, MetronomeChallengeListSchema);
    },
    listEncoreCouncilRounds(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/encore-council-rounds?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, EncoreCouncilRoundListSchema);
    },
    listCertifications(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/certifications?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, CertificationListSchema);
    },
    generateConcertmasterReport(goalId, query, commandId) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/concertmaster-report`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
        body: JSON.stringify(parsed),
      }, ConcertmasterFinalReportSchema);
    },
    getConcertmasterReport(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/concertmaster-report?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, ConcertmasterFinalReportSchema);
    },
    getEvidenceBundle(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/evidence-bundle?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, EvidenceBundleReadSchema);
    },
    getGitIntegrationState(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/git/integration-state?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, GoalGitIntegrationStateSchema);
    },
    listWorkersForGoal(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/workers?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, WorkerListSchema);
    },
    listImprovementDigestsForGoal(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(`v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/improvement-digests?${new URLSearchParams({ projectId: parsed.projectId })}`, { headers }, ImprovementDigestListSchema);
    },
    listEvents(query) {
      const parsed = EventQuerySchema.parse(query);
      return request(`v1/events?${new URLSearchParams({ projectId: parsed.projectId, after: parsed.after })}`, { headers }, GoalEventPageSchema);
    },
    streamEvents(query, options) {
      return readEventStream(fetch, base, headers, query, options?.signal);
    },
  };
}

export type { CreateGoalInput, CreateTaskContractInput, ProviderAccountLoginStartResult, ProviderAccountLoginStatus, TaskContract, TaskContractConfirmationInput, TaskContractQuery, UpdateTaskContractInput, OvertureSelectionInput, OvertureRoleSelectionResult, EventQuery, GoalEvent, GoalEventPage, GoalQuery, GoalList, ProjectList, GoalBudgetSummary, GoalResult, TransitionGoalInput, ProjectAccessProvisionInput, ProjectAccessProvisionResult, MetronomeChallengeList, EncoreCouncilRoundList, CertificationList, ConcertmasterFinalReport, EvidenceBundleRead, GoalGitIntegrationState, WorkerList, WorkerObservation, ImprovementDigestList };
