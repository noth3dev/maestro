import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { AccountLoginRecord, AccountLoginStore, OperatorAuthentication, OperatorContext } from "@maestro/persistence";
import { GitOperationError } from "@maestro/domain";
import {
  HeadActivationCycleError,
  HeadActivationBindingConflictError,
  HeadActivationRuntimeConflictError,
  HeadCouncilNotFoundError,
  CouncilBriefsSealedError,
  CouncilProtocolError,
  DepartmentPlanError,
  DepartmentPlanNotFoundError,
  MissionBundleError,
  MissionBundleNotFoundError,
} from "@maestro/persistence";
import {
  ProjectAccessAdminRequiredError,
  ProjectAccessRoleNotFoundError,
  ProjectAccessTargetNotFoundError,
  ProjectMembershipRequiredError,
  ProjectRoleRequiredError,
} from "@maestro/persistence";
import {
  CreateGoalInputSchema,
  CriticalActionInputSchema,
  CriticalActionApprovalInputSchema,
  CriticalActionResultSchema,
  GoalQuerySchema,
  GoalListSchema,
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
  ProjectListSchema,
  GoalBudgetSummarySchema,
  GoalResultSchema,
  MetronomeChallengeListSchema,
  EncoreCouncilRoundListSchema,
  CertificationListSchema,
  ConcertmasterFinalReportSchema,
  GoalGitIntegrationStateSchema,
  WorkerListSchema,
  ImprovementDigestListSchema,
  AuthenticatedDiscordSignalSchema,
  StoredDiscordSignalSchema,
  EventQuerySchema,
  EventCursorSchema,
  GoalEventPageSchema,
  type EventCursor,
  CreateTaskContractInputSchema,
  TaskContractSchema,
  TaskContractQuerySchema,
  UpdateTaskContractInputSchema,
  OvertureSelectionInputSchema,
  OvertureRoleSelectionResultSchema,
  TaskContractConfirmationInputSchema,
  StableApiErrorSchema,
  ProjectAccessProvisionInputSchema,
  ProjectAccessProvisionResultSchema,
  TransitionGoalInputSchema,
  GoalControlInputSchema,
  UuidSchema,
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
  WorkerActionInputSchema,
  GoalIntegrationBranchInputSchema,
  GoalIntegrationBranchSchema,
  GoalIntegrationRevisionSchema,
  DepartmentBranchSchema,
  DepartmentBranchInputSchema,
  WorkerWorktreeSchema,
  WorkerWorktreeInputSchema,
  MetronomeScanInputSchema,
  MetronomeFindingListSchema,
  RaiseMetronomeChallengeInputSchema,
  MetronomeCorrectionInputSchema,
  MetronomeSafePauseInputSchema,
  MetronomeResolutionInputSchema,
  MetronomeChallengeSchema,
  EncoreReviewInputSchema,
  EncoreCouncilResultSchema,
  AcceptWorkerInputSchema,
  DepartmentAcceptanceSchema,
  CertifyWorkerInputSchema,
  CertificationSchema,
  type StableApiError,
} from "@maestro/contracts";
import {
  CommandIdReuseError,
  DurableStoreUnavailableError,
  GoalNotFoundError,
  InvalidTransitionError,
  LeaseUnavailableError,
  StaleLeaseError,
  VersionConflictError,
  TaskContractIntegrityError as GoalTaskContractIntegrityError,
  type GoalService,
} from "./goal-service.js";
import {
  CriticalActionApprovalConflictError,
  CriticalActionApprovalExpiredError,
  CriticalActionApprovalForbiddenError,
  CriticalActionUnavailableError,
  CriticalActionGoalNotFoundError,
  CriticalActionProjectMismatchError,
  type CriticalActionService,
} from "./critical-action-service.js";
import { ReadStateGoalNotFoundError, type ReadStateService } from "./read-state-service.js";
import {
  ExactConfirmationRequiredError,
  TaskContractConflictError,
  TaskContractIntegrityError,
  TaskContractNotFoundError,
  TaskContractProjectBoundaryError,
  TaskContractProjectMismatchError,
  TaskContractVersionConflictError,
  type TaskContractService,
} from "./task-contract-service.js";
import {
  HeadGoalNotFoundError,
  HeadProjectMismatchError,
  HeadContractMismatchError,
  type HeadParticipationService,
} from "./head-participation-service.js";
import {
  CouncilContractMismatchError,
  CouncilGoalNotFoundError,
  CouncilProjectMismatchError,
  type CouncilService,
} from "./council-service.js";

export type { GoalService } from "./goal-service.js";
export type { CriticalActionService } from "./critical-action-service.js";
export type { TaskContractService } from "./task-contract-service.js";
export type { HeadParticipationService } from "./head-participation-service.js";
export type { CouncilService } from "./council-service.js";
import { DepartmentPlanProjectMismatchError, type DepartmentPlanService } from "./department-plan-service.js";
import { MissionBundleProjectMismatchError, type MissionBundleService } from "./mission-bundle-service.js";
import { WorkerProjectMismatchError, WorkerCapacityExceededError, type WorkerService } from "./worker-service.js";
import { ConversationConflictError, ConversationModelNotAllowedError, ConversationNotFoundError, ConversationUnavailableError, type ConversationService } from "./conversation-service.js";
import { ModelGatewayClientError } from "./model-gateway-client.js";
import { WorkerError, WorkerNotFoundError } from "@maestro/persistence";
import { GitProjectMismatchError, type GitIntegrationService } from "./git-integration-service.js";
import type { CertificationService } from "./certification-service.js";
import type { MetronomeService } from "./metronome-service.js";
import { EncoreProjectMismatchError, type EncoreService } from "./encore-service.js";
import { GitIntegrationError, GitIntegrationNotFoundError, CertificationError, CertificationNotFoundError, MetronomeChallengeError, MetronomeChallengeNotFoundError, MetronomeAuthorizationError, EncoreCouncilError, StaleGoalLeaseError, HeadActivationRequesterInactiveError, DiscordPersistenceError, type StoredDiscordSignal } from "@maestro/persistence";
import { GitAuthorizationError } from "@maestro/git-adapter";
import type { AuthenticatedDiscordSignal } from "@maestro/domain";

export interface DiscordSignalService {
  record(envelope: AuthenticatedDiscordSignal): Promise<StoredDiscordSignal>;
}

export type ReadStateUnavailableService = ReadStateService;

export interface EventService {
  listEvents(projectId: string, after: EventCursor): Promise<import("@maestro/contracts").GoalEvent[]>;
}

export interface ProjectDiscoveryService {
  /** Lists only active projects visible to this authenticated operator. */
  listProjects(operatorId: string): Promise<readonly string[]>;
}

export interface ProviderCredentialService {
  bind(input: { operatorId: string; requestId: string; providerId: "openai" | "anthropic"; authMode: "api-key"; secret: string }): Promise<import("@maestro/agent-runtime").GatewayCredentialBinding>;
  revoke(input: { operatorId: string; requestId: string; providerId: "openai" | "anthropic" }): Promise<void>;
  startAccountLogin?(input: { operatorId: string; requestId: string; providerId: "openai-codex" }): Promise<import("@maestro/agent-runtime").GatewayAccountLoginStartResult>;
  accountLoginStatus?(input: { operatorId: string; requestId: string; providerId: "openai-codex"; loginId: string }): Promise<import("@maestro/agent-runtime").GatewayAccountLoginStatusResult>;
  cancelAccountLogin?(input: { operatorId: string; requestId: string; providerId: "openai-codex"; loginId: string }): Promise<void>;
  logoutAccount?(input: { operatorId: string; requestId: string; providerId: "openai-codex" }): Promise<void>;
}

export interface OperatorAuthenticator {
  authenticateBearerSecret(secret: string): Promise<OperatorAuthentication>;
}

export class ProjectAccessForbiddenError extends Error {}

export interface ProjectMembershipChecker {
  /** Fails closed unless the operator currently holds an active membership for this exact project. */
  assertProjectMembership(operatorId: string, projectId: string): Promise<void>;
}

export interface ProjectAccessProvisioner {
  /** Grants a target operator exact standing project roles under an explicit admin policy. */
  provisionProjectAccess(requesterOperatorId: string, input: import("@maestro/contracts").ProjectAccessProvisionInput): Promise<import("@maestro/contracts").ProjectAccessProvisionResult>;
}

export interface PollingScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemPollingScheduler: PollingScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

function toAccountLoginStartResult(record: AccountLoginRecord): import("@maestro/agent-runtime").GatewayAccountLoginStartResult {
  if (record.providerLoginId === null || record.authUrl === null) throw new Error(record.message ?? "Provider account login is not ready");
  return { providerId: record.providerId, loginId: record.loginId, authUrl: record.authUrl };
}

function isLostGatewayLogin(error: unknown): boolean {
  return error instanceof ModelGatewayClientError && error.code === "account_login_session_unknown";
}

async function waitForAccountLoginStart(store: AccountLoginStore, operatorId: string, requestId: string): Promise<AccountLoginRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = await store.getByRequest(operatorId, requestId);
    if (record !== undefined && record.state !== "starting") return record;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("account login start is still in progress");
}

export function buildServer({ goalService, authenticator, eventService, criticalActionService, pollingScheduler = systemPollingScheduler, readStateService, taskContractService, headParticipationService, councilService, departmentPlanService, missionBundleService, workerService, gitIntegrationService, certificationService, metronomeService, encoreService, discordSignalService, https, projectMembership, projectAccess, projectDiscovery, providerCredentials, accountLoginStore, accountLoginOwnerId, readinessCheck, conversationService }: {
  goalService: GoalService;
  authenticator: OperatorAuthenticator;
  eventService?: EventService;
  criticalActionService?: CriticalActionService;
  pollingScheduler?: PollingScheduler;
  readStateService?: ReadStateService;
  taskContractService?: TaskContractService;
  headParticipationService?: HeadParticipationService;
  councilService?: CouncilService;
  departmentPlanService?: DepartmentPlanService;
  missionBundleService?: MissionBundleService;
  workerService?: WorkerService;
  gitIntegrationService?: GitIntegrationService;
  certificationService?: CertificationService;
  metronomeService?: MetronomeService;
  encoreService?: EncoreService;
  discordSignalService?: DiscordSignalService;
  /** When set, the listener is real HTTPS, not plain HTTP. */
  https?: { cert: Buffer; key: Buffer };
  /**
   * When set, every request that carries a projectId (body or query) is
   * checked against durable project membership before its route handler
   * runs. Optional only so existing tests/composition that do not yet
   * exercise membership can omit it without inventing a fake always-allow
   * checker; production composition (main.ts) always supplies a real one.
   * All Goal-scoped routes carry projectId and are checked here before their
   * route handler runs.
   */
  projectMembership?: ProjectMembershipChecker;
  /** Authenticated project discovery used for first-run workspace attachment. */
  projectDiscovery?: ProjectDiscoveryService;
  /** Provider credential lifecycle delegated to the separately authenticated gateway. */
  providerCredentials?: ProviderCredentialService;
  /** Durable account-login idempotency and restart state. Production always supplies this. */
  accountLoginStore?: AccountLoginStore;
  /** Per-process owner nonce used to fence a pre-start login after a Control Plane restart. */
  accountLoginOwnerId?: string;
  /** Explicitly configured admin-only project membership and role provisioning. */
  projectAccess?: ProjectAccessProvisioner;
  /** Dependency probe used by /readyz. Liveness never calls this check. */
  readinessCheck?: () => Promise<void>;
  conversationService?: ConversationService;
}): FastifyInstance {
  const app: FastifyInstance = https
    ? (Fastify({ https }) as unknown as FastifyInstance)
    : Fastify();
  const activeStreams = new Set<() => void>();
  const maxActiveStreams = 128;
  const loginOwnerId = accountLoginOwnerId ?? `control-plane-${randomUUID()}`;
  const loginOperationStaleAfterMs = 30_000;
  const events = eventService ?? { listEvents: async () => { throw new DurableStoreUnavailableError(); } };
  const readState = readStateService ?? {
    listGoals: async () => { throw new DurableStoreUnavailableError(); },
    getBudgetSummary: async () => { throw new DurableStoreUnavailableError(); },
    listMetronomeChallenges: async () => { throw new DurableStoreUnavailableError(); },
    listEncoreCouncilRounds: async () => { throw new DurableStoreUnavailableError(); },
    listCertifications: async () => { throw new DurableStoreUnavailableError(); },
    getConcertmasterReport: async () => { throw new DurableStoreUnavailableError(); },
    getGitIntegrationState: async () => { throw new DurableStoreUnavailableError(); },
    listWorkersForGoal: async () => { throw new DurableStoreUnavailableError(); },
    listImprovementDigestsForGoal: async () => { throw new DurableStoreUnavailableError(); },
  };
  const criticalActions = criticalActionService ?? {
    performCriticalAction: async () => { throw new CriticalActionUnavailableError(); },
    approveAndPerformCriticalAction: async () => { throw new CriticalActionUnavailableError(); },
  };
  const taskContracts = taskContractService ?? {
    createTaskContract: async () => { throw new DurableStoreUnavailableError(); },
    getTaskContract: async () => { throw new DurableStoreUnavailableError(); },
    updateTaskContract: async () => { throw new DurableStoreUnavailableError(); },
    selectOvertureRoles: async () => { throw new DurableStoreUnavailableError(); },
    confirmTaskContract: async () => { throw new DurableStoreUnavailableError(); },
    launchTaskContract: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies TaskContractService;
  const headParticipations = headParticipationService ?? {
    activate: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies HeadParticipationService;
  const councils = councilService ?? {
    create: async () => { throw new DurableStoreUnavailableError(); },
    get: async () => { throw new DurableStoreUnavailableError(); },
    submitBrief: async () => { throw new DurableStoreUnavailableError(); },
    reveal: async () => { throw new DurableStoreUnavailableError(); },
    decide: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies CouncilService;
  const departmentPlans = departmentPlanService ?? {
    create: async () => { throw new DurableStoreUnavailableError(); },
    get: async () => { throw new DurableStoreUnavailableError(); },
    revise: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies DepartmentPlanService;
  const missionBundles = missionBundleService ?? {
    create: async () => { throw new DurableStoreUnavailableError(); },
    get: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies MissionBundleService;
  const workers = workerService ?? {
    spawn: async () => { throw new DurableStoreUnavailableError(); },
    get: async () => { throw new DurableStoreUnavailableError(); },
    observe: async () => { throw new DurableStoreUnavailableError(); },
    cancel: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies WorkerService;
  const gitIntegrations = gitIntegrationService ?? {
    createGoalBranch: async () => { throw new DurableStoreUnavailableError(); },
    createDepartmentBranch: async () => { throw new DurableStoreUnavailableError(); },
    createWorkerWorktree: async () => { throw new DurableStoreUnavailableError(); },
    freezeGoalRevision: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies GitIntegrationService;
  const certifications = certificationService ?? {
    accept: async () => { throw new DurableStoreUnavailableError(); },
    certify: async () => { throw new DurableStoreUnavailableError(); },
    certifyConditional: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies CertificationService;
  const metronome = metronomeService ?? {
    scan: async () => { throw new DurableStoreUnavailableError(); },
    raise: async () => { throw new DurableStoreUnavailableError(); },
    requestCorrection: async () => { throw new DurableStoreUnavailableError(); },
    requestSafePause: async () => { throw new DurableStoreUnavailableError(); },
    resolve: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies MetronomeService;
  const encore = encoreService ?? { review: async () => { throw new DurableStoreUnavailableError(); } } satisfies EncoreService;
  const discordSignal = discordSignalService ?? { record: async () => { throw new DurableStoreUnavailableError(); } } satisfies DiscordSignalService;
  const conversations = conversationService ?? {
    listModels: async () => { throw new DurableStoreUnavailableError(); },
    create: async () => { throw new DurableStoreUnavailableError(); },
    get: async () => { throw new DurableStoreUnavailableError(); },
    turn: async () => { throw new DurableStoreUnavailableError(); },
    cancel: async () => { throw new DurableStoreUnavailableError(); },
    listEvents: async () => { throw new DurableStoreUnavailableError(); },
  } satisfies ConversationService;
  // preClose runs while Fastify can still release open HTTP responses. onClose is too late:
  // Fastify waits for those connections before it invokes onClose.
  app.addHook("preClose", async () => {
    for (const terminate of [...activeStreams]) terminate();
  });
  // Fastify's preClose hook runs from its onClose sequence, after Node may
  // already be waiting on an open keep-alive response. End owned SSE streams
  // before delegating to Fastify's close implementation.
  app.addHook("onReady", async () => {
    const fastifyClose = app.close.bind(app);
    app.close = ((callback?: () => void) => {
      for (const terminate of [...activeStreams]) terminate();
      if (callback === undefined) return fastifyClose();
      return fastifyClose(callback);
    }) as typeof app.close;
  });

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/v1/")) return;
    const secret = bearerSecret(request.headers.authorization);
    if (secret === undefined) throw new AuthenticationRequiredError();
    const authentication = await authenticator.authenticateBearerSecret(secret);
    if (authentication.outcome === "invalid") throw new AuthenticationRequiredError();
    if (authentication.outcome === "forbidden") throw new CredentialForbiddenError();
    if (authentication.outcome === "unavailable") throw new AuthenticationUnavailableError();
    (request as typeof request & { operator: OperatorContext }).operator = authentication.operator;
  });

  // Authentication alone only proves the credential is valid; it says
  // nothing about which project that operator may act on. This hook runs
  // after body/query parsing (preHandler, not onRequest) so it can read the
  // request's stated projectId, then fails closed unless durable membership
  // exists for it -- before the route handler (and thus goalService/
  // criticalActionService/eventService) ever runs.
  app.addHook("preHandler", async (request) => {
    // Provisioning is a global admin operation, not a project-scoped action:
    // its own explicit admin policy replaces membership for this route.
    if (!request.url.startsWith("/v1/") || isProjectAccessProvisioningRoute(request.url) || !projectMembership) return;
    const operator = (request as typeof request & { operator?: OperatorContext }).operator;
    if (!operator) return;
    const candidate = requestProjectId(request);
    if (candidate === undefined) return;
    await projectMembership.assertProjectMembership(operator.operatorId, candidate);
  });

  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapError(error);
    reply.status(mapped.status).send(mapped.body);
  });

  app.get("/healthz", async (_request, reply) => reply.status(200).send({ status: "ok" }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await readinessCheck?.();
      return reply.status(200).send({ status: "ready" });
    } catch {
      return reply.status(503).send({ status: "not_ready" });
    }
  });

  app.post("/v1/admin/project-access", async (request, reply) => {
    if (!projectAccess) throw new DurableStoreUnavailableError();
    const input = parse(ProjectAccessProvisionInputSchema, request.body);
    const result = await projectAccess.provisionProjectAccess(requestOperator(request as { operator?: OperatorContext }).operatorId, input);
    return reply.status(200).send(ProjectAccessProvisionResultSchema.parse(result));
  });

  app.get("/v1/projects", async (request, reply) => {
    if (!projectDiscovery) throw new DurableStoreUnavailableError();
    const projects = await projectDiscovery.listProjects(requestOperator(request as { operator?: OperatorContext }).operatorId);
    return reply.status(200).send(ProjectListSchema.parse({ projects }));
  });

  app.post("/v1/provider-credentials", async (request, reply) => {
    if (!providerCredentials) throw new DurableStoreUnavailableError();
    const input = parse(ProviderCredentialLoginInputSchema, request.body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const result = await providerCredentials.bind({
      operatorId: requestOperator(request as { operator?: OperatorContext }).operatorId,
      requestId,
      providerId: input.providerId,
      authMode: input.authMode,
      secret: input.secret,
    });
    return reply.status(200).send(ProviderCredentialBindingSchema.parse(result));
  });

  app.post("/v1/provider-account-logins/start", async (request, reply) => {
    const input = parse(ProviderAccountLoginStartInputSchema, request.body);
    if (!providerCredentials?.startAccountLogin || accountLoginStore === undefined) throw new DurableStoreUnavailableError();
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const reservation = await accountLoginStore.reserveStart(operatorId, requestId, input.providerId, loginOwnerId);
    let record = reservation.record;
    if (reservation.created) {
      try {
        const providerResult = await providerCredentials.startAccountLogin({ operatorId, requestId, providerId: input.providerId });
        record = await accountLoginStore.completeStart(record.loginId, providerResult.loginId, providerResult.authUrl);
      } catch (error) {
        await accountLoginStore.failStart(record.loginId, "Provider account login failed").catch(() => undefined);
        throw error;
      }
    } else if (record.state === "starting") {
      record = await waitForAccountLoginStart(accountLoginStore, operatorId, requestId);
    }
    return reply.status(200).send(ProviderAccountLoginStartResultSchema.parse(toAccountLoginStartResult(record)));
  });

  app.post("/v1/provider-account-logins/logout", async (request, reply) => {
    if (!providerCredentials?.logoutAccount) throw new DurableStoreUnavailableError();
    const input = parse(ProviderAccountLoginStartInputSchema, request.body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    await providerCredentials.logoutAccount({ operatorId: requestOperator(request as { operator?: OperatorContext }).operatorId, requestId, providerId: input.providerId });
    return reply.status(200).send({ revoked: true });
  });

  app.post("/v1/provider-account-logins/status", async (request, reply) => {
    if (!providerCredentials?.accountLoginStatus || accountLoginStore === undefined) throw new DurableStoreUnavailableError();
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const input = parse(ProviderAccountLoginStatusSchema.pick({ providerId: true, loginId: true }), body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const record = await accountLoginStore.get(input.loginId, operatorId);
    if (record === undefined || record.providerId !== input.providerId) throw new Error("account login session is unknown");
    if (record.state === "starting") return reply.status(200).send(ProviderAccountLoginStatusSchema.parse({ providerId: record.providerId, loginId: record.loginId, state: "pending" }));
    if (record.state !== "pending" || record.providerLoginId === null) return reply.status(200).send(ProviderAccountLoginStatusSchema.parse({ providerId: record.providerId, loginId: record.loginId, state: record.state, ...(record.message === null ? {} : { message: record.message }) }));
    const operationToken = await accountLoginStore.claimOperation(record.loginId, operatorId, "status", loginOwnerId, loginOperationStaleAfterMs);
    if (operationToken === undefined) {
      const current = await accountLoginStore.get(record.loginId, operatorId);
      if (current === undefined) throw new Error("account login session is unknown");
      if (current.state !== "pending" || current.providerLoginId === null) return reply.status(200).send(ProviderAccountLoginStatusSchema.parse({ providerId: current.providerId, loginId: current.loginId, state: current.state, ...(current.message === null ? {} : { message: current.message }) }));
      return reply.status(409).send({ error: { code: "account_login_operation_in_progress", message: "provider account login operation is already in progress" } });
    }
    try {
      let result: import("@maestro/agent-runtime").GatewayAccountLoginStatusResult;
      try {
        result = await providerCredentials.accountLoginStatus({ operatorId, requestId, providerId: input.providerId, loginId: record.providerLoginId });
      } catch (error) {
        if (!isLostGatewayLogin(error)) throw error;
        const unknown = await accountLoginStore.updateState(record.loginId, operatorId, "unknown", "Gateway login session was lost during restart", loginOwnerId, operationToken);
        return reply.status(200).send(ProviderAccountLoginStatusSchema.parse({ providerId: unknown.providerId, loginId: unknown.loginId, state: unknown.state, message: unknown.message }));
      }
      const updated = await accountLoginStore.updateState(record.loginId, operatorId, result.state, result.message, loginOwnerId, operationToken);
      return reply.status(200).send(ProviderAccountLoginStatusSchema.parse({ providerId: updated.providerId, loginId: updated.loginId, state: updated.state, ...(updated.message === null ? {} : { message: updated.message }) }));
    } finally {
      await accountLoginStore.releaseOperation(record.loginId, operatorId, loginOwnerId, operationToken).catch(() => undefined);
    }
  });

  app.post("/v1/provider-account-logins/cancel", async (request, reply) => {
    if (!providerCredentials?.cancelAccountLogin || accountLoginStore === undefined) throw new DurableStoreUnavailableError();
    const input = parse(ProviderAccountLoginStatusSchema.pick({ providerId: true, loginId: true }), request.body);
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const record = await accountLoginStore.get(input.loginId, operatorId);
    if (record === undefined || record.providerId !== input.providerId) throw new Error("account login session is unknown");
    if (record.state !== "pending" || record.providerLoginId === null) return reply.status(200).send({ cancelled: record.state === "cancelled" });
    const operationToken = await accountLoginStore.claimOperation(record.loginId, operatorId, "cancel", loginOwnerId, loginOperationStaleAfterMs);
    if (operationToken === undefined) {
      const current = await accountLoginStore.get(record.loginId, operatorId);
      if (current === undefined) throw new Error("account login session is unknown");
      if (current.state !== "pending" || current.providerLoginId === null) return reply.status(200).send({ cancelled: current.state === "cancelled" });
      return reply.status(409).send({ error: { code: "account_login_operation_in_progress", message: "provider account login operation is already in progress" } });
    }
    try {
      try {
        await providerCredentials.cancelAccountLogin({ operatorId, requestId, providerId: input.providerId, loginId: record.providerLoginId });
        await accountLoginStore.updateState(record.loginId, operatorId, "cancelled", undefined, loginOwnerId, operationToken);
      } catch (error) {
        if (!isLostGatewayLogin(error)) throw error;
        await accountLoginStore.updateState(record.loginId, operatorId, "unknown", "Gateway login session was lost during restart", loginOwnerId, operationToken);
        return reply.status(200).send({ cancelled: false });
      }
      return reply.status(200).send({ cancelled: true });
    } finally {
      await accountLoginStore.releaseOperation(record.loginId, operatorId, loginOwnerId, operationToken).catch(() => undefined);
    }
  });

  app.delete("/v1/provider-credentials/:providerId", async (request, reply) => {
    if (!providerCredentials) throw new DurableStoreUnavailableError();
    const providerId = (request.params as { providerId?: unknown }).providerId;
    if (providerId !== "openai" && providerId !== "anthropic") throw new RequestValidationError();
    const header = request.headers["idempotency-key"];
    const requestId = typeof header === "string" && header.trim() !== "" ? header : randomUUID();
    await providerCredentials.revoke({
      operatorId: requestOperator(request as { operator?: OperatorContext }).operatorId,
      requestId,
      providerId,
    });
    return reply.status(200).send({ revoked: true });
  });

  app.post("/v1/goals", async (request, reply) => {
    const input = parse(CreateGoalInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await goalService.createGoal(input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(GoalResultSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/head-participations", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(HeadParticipationInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const participation = await headParticipations.activate(
      goalId,
      input,
      requestOperator(request as { operator?: OperatorContext }),
      commandId,
    );
    return reply.status(200).send(HeadParticipationSchema.parse(participation));
  });

  app.post("/v1/goals/:goalId/councils", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(CreateHeadCouncilInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const council = await councils.create(goalId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(HeadCouncilSchema.parse(council));
  });

  app.get("/v1/councils/:councilId", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.status(200).send(HeadCouncilSchema.parse(await councils.get(councilId, query.projectId)));
  });

  app.post("/v1/councils/:councilId/briefs/:departmentId", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const departmentId = parseDepartmentId((request.params as { departmentId?: unknown }).departmentId);
    const input = parse(SubmitCouncilBriefInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    await councils.submitBrief(councilId, departmentId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(204).send();
  });

  app.post("/v1/councils/:councilId/reveal", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const input = parse(GoalQuerySchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    await councils.reveal(councilId, input.projectId, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(204).send();
  });

  app.post("/v1/councils/:councilId/decision", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const input = parse(HeadCouncilDecisionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const council = await councils.decide(councilId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(HeadCouncilSchema.parse(council));
  });

  app.post("/v1/councils/:councilId/departments/:departmentId/plan", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const departmentId = parseDepartmentId((request.params as { departmentId?: unknown }).departmentId);
    const input = parse(CreateDepartmentPlanInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const plan = await departmentPlans.create(councilId, departmentId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(DepartmentPlanSchema.parse(plan));
  });

  app.get("/v1/councils/:councilId/departments/:departmentId/plan", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const departmentId = parseDepartmentId((request.params as { departmentId?: unknown }).departmentId);
    const query = parse(GoalQuerySchema, request.query);
    const plan = await departmentPlans.get(councilId, departmentId, query.projectId);
    return reply.status(200).send(DepartmentPlanSchema.parse(plan));
  });

  app.put("/v1/councils/:councilId/departments/:departmentId/plan", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const departmentId = parseDepartmentId((request.params as { departmentId?: unknown }).departmentId);
    const input = parse(ReviseDepartmentPlanInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const plan = await departmentPlans.revise(councilId, departmentId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(DepartmentPlanSchema.parse(plan));
  });

  app.post("/v1/councils/:councilId/departments/:departmentId/mission-bundles/:itemId", async (request, reply) => {
    const params = request.params as { councilId?: unknown; departmentId?: unknown; itemId?: unknown };
    const councilId = parse(UuidSchema, params.councilId);
    const departmentId = parseDepartmentId(params.departmentId);
    const itemId = parseItemId(params.itemId);
    const input = parse(CreateMissionBundleInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const bundle = await missionBundles.create(councilId, departmentId, itemId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(MissionBundleSchema.parse(bundle));
  });

  app.get("/v1/councils/:councilId/departments/:departmentId/mission-bundles/:itemId", async (request, reply) => {
    const params = request.params as { councilId?: unknown; departmentId?: unknown; itemId?: unknown };
    const councilId = parse(UuidSchema, params.councilId);
    const departmentId = parseDepartmentId(params.departmentId);
    const itemId = parseItemId(params.itemId);
    const query = request.query as { projectId?: unknown; planVersion?: unknown };
    const projectId = parse(UuidSchema, query.projectId);
    const planVersion = parsePositiveInteger(query.planVersion);
    const bundle = await missionBundles.get(councilId, departmentId, planVersion, itemId, projectId);
    return reply.status(200).send(MissionBundleSchema.parse(bundle));
  });

  app.post("/v1/councils/:councilId/departments/:departmentId/workers", async (request, reply) => {
    const params = request.params as { councilId?: unknown; departmentId?: unknown };
    const councilId = parse(UuidSchema, params.councilId);
    const departmentId = parseDepartmentId(params.departmentId);
    const input = parse(SpawnWorkerInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const worker = await workers.spawn(councilId, departmentId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(WorkerSchema.parse(worker));
  });

  app.post("/v1/workers/:workerId/observe", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(WorkerActionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const worker = await workers.observe(workerId, input.projectId, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(WorkerSchema.parse(worker));
  });

  app.post("/v1/workers/:workerId/cancel", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(WorkerActionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const worker = await workers.cancel(workerId, input.projectId, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(WorkerSchema.parse(worker));
  });

  app.post("/v1/workers/:workerId/accept", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(AcceptWorkerInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await certifications.accept(workerId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(DepartmentAcceptanceSchema.parse(result));
  });

  app.post("/v1/workers/:workerId/certifications/quality", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(CertifyWorkerInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await certifications.certify(workerId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(CertificationSchema.parse({ ...result, kind: "quality" }));
  });

  app.post("/v1/workers/:workerId/certifications/:kind", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const kind = parseCertificationKind((request.params as { kind?: unknown }).kind);
    const input = parse(CertifyWorkerInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await certifications.certifyConditional(workerId, kind, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(CertificationSchema.parse(result));
  });

  app.get("/v1/workers/:workerId", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const query = parse(GoalQuerySchema, request.query);
    const worker = await workers.get(workerId, query.projectId);
    return reply.status(200).send(WorkerSchema.parse(worker));
  });

  app.post("/v1/goals/:goalId/encore/reviews", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(EncoreReviewInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await encore.review(goalId, input, commandId);
    return reply.status(201).send(EncoreCouncilResultSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/metronome/scan", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(MetronomeScanInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.scan(goalId, input.projectId, commandId);
    return reply.status(200).send(MetronomeFindingListSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/metronome/challenges", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(RaiseMetronomeChallengeInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.raise(goalId, input, commandId);
    return reply.status(201).send(MetronomeChallengeSchema.parse(result));
  });

  app.post("/v1/metronome/challenges/:challengeId/correction", async (request, reply) => {
    const challengeId = parse(UuidSchema, (request.params as { challengeId?: unknown }).challengeId);
    const input = parse(MetronomeCorrectionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.requestCorrection(challengeId, input, commandId);
    return reply.status(200).send(MetronomeChallengeSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/metronome/challenges/:challengeId/safe-pause", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const challengeId = parse(UuidSchema, (request.params as { challengeId?: unknown }).challengeId);
    const input = parse(MetronomeSafePauseInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.requestSafePause(goalId, challengeId, input, commandId);
    return reply.status(200).send(MetronomeChallengeSchema.parse(result));
  });

  app.post("/v1/metronome/challenges/:challengeId/resolve", async (request, reply) => {
    const challengeId = parse(UuidSchema, (request.params as { challengeId?: unknown }).challengeId);
    const input = parse(MetronomeResolutionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const result = await metronome.resolve(challengeId, input, commandId, operatorId);
    return reply.status(200).send(MetronomeChallengeSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/git/integration-branch", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(GoalIntegrationBranchInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await gitIntegrations.createGoalBranch(goalId, input, requestOperator(request as { operator?: OperatorContext }).operatorId, commandId);
    return reply.status(201).send(GoalIntegrationBranchSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/git/integration-revision", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(DepartmentBranchInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await gitIntegrations.freezeGoalRevision(goalId, input.projectId, requestOperator(request as { operator?: OperatorContext }).operatorId, commandId);
    return reply.status(201).send(GoalIntegrationRevisionSchema.parse(result));
  });

  app.post("/v1/councils/:councilId/departments/:departmentId/git/branch", async (request, reply) => {
    const params = request.params as { councilId?: unknown; departmentId?: unknown };
    const councilId = parse(UuidSchema, params.councilId);
    const departmentId = parseDepartmentId(params.departmentId);
    const input = parse(DepartmentBranchInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const result = await gitIntegrations.createDepartmentBranch(councilId, departmentId, input.projectId, operatorId, commandId);
    return reply.status(201).send(DepartmentBranchSchema.parse(result));
  });

  app.post("/v1/workers/:workerId/git/worktree", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(WorkerWorktreeInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const result = await gitIntegrations.createWorkerWorktree(workerId, input, operatorId, commandId);
    return reply.status(201).send(WorkerWorktreeSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/transitions", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(TransitionGoalInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await goalService.transitionGoal(goalId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(GoalResultSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/pause", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(GoalControlInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await goalService.pauseGoal(goalId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(GoalResultSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/stop", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(GoalControlInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await goalService.stopGoal(goalId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(GoalResultSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/resume", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(GoalControlInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await goalService.resumeGoal(goalId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(GoalResultSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/emergency-stop", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(GoalControlInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await goalService.emergencyStopGoal(goalId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(GoalResultSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/critical-actions", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(CriticalActionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const decision = await criticalActions.performCriticalAction(
      goalId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    if (decision.effect === "deny") throw new CriticalActionDeniedError(decision.reason);
    if (decision.effect === "require_approval") throw new CriticalActionRequiresApprovalError(decision.reason);
    return reply.status(200).send(CriticalActionResultSchema.parse({
      goalId,
      effect: decision.effect,
      reason: decision.reason,
      classification: decision.classification,
      ...(decision.recordId === undefined ? {} : { recordId: decision.recordId }),
    }));
  });

  app.post("/v1/goals/:goalId/critical-actions/approve-and-run", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(CriticalActionApprovalInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const decision = await criticalActions.approveAndPerformCriticalAction(
      goalId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    if (decision.effect === "deny") throw new CriticalActionDeniedError(decision.reason);
    if (decision.effect === "require_approval") throw new CriticalActionRequiresApprovalError(decision.reason);
    return reply.status(200).send(CriticalActionResultSchema.parse({
      goalId,
      effect: decision.effect,
      reason: decision.reason,
      classification: decision.classification,
      ...(decision.recordId === undefined ? {} : { recordId: decision.recordId }),
    }));
  });

  app.post("/v1/task-contracts", async (request, reply) => {
    const contractId = parse(UuidSchema, request.headers["idempotency-key"]);
    const input = parse(CreateTaskContractInputSchema, request.body);
    const result = await taskContracts.createTaskContract(contractId, input, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(TaskContractSchema.parse(result));
  });

  app.get("/v1/task-contracts/:contractId", async (request, reply) => {
    const contractId = parse(UuidSchema, (request.params as { contractId?: unknown }).contractId);
    const query = parse(TaskContractQuerySchema, request.query);
    const result = await taskContracts.getTaskContract(contractId, query.projectId);
    return reply.status(200).send(TaskContractSchema.parse(result));
  });

  app.put("/v1/task-contracts/:contractId", async (request, reply) => {
    const contractId = parse(UuidSchema, (request.params as { contractId?: unknown }).contractId);
    const input = parse(UpdateTaskContractInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"] ?? contractId);
    const result = await taskContracts.updateTaskContract(contractId, input, requestOperator(request as { operator?: OperatorContext }), commandId);
    return reply.status(200).send(TaskContractSchema.parse(result));
  });

  app.post("/v1/task-contracts/:contractId/overture-selection", async (request, reply) => {
    const contractId = parse(UuidSchema, (request.params as { contractId?: unknown }).contractId);
    const input = parse(OvertureSelectionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"] ?? contractId);
    const roles = await taskContracts.selectOvertureRoles(contractId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(OvertureRoleSelectionResultSchema.parse({ roles }));
  });

  app.post("/v1/task-contracts/:contractId/confirmation", async (request, reply) => {
    const contractId = parse(UuidSchema, (request.params as { contractId?: unknown }).contractId);
    const input = parse(TaskContractConfirmationInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"] ?? contractId);
    await taskContracts.confirmTaskContract(contractId, input, requestOperator(request as { operator?: OperatorContext }), commandId);
    return reply.status(204).send();
  });

  app.post("/v1/task-contracts/:contractId/launch", async (request, reply) => {
    const contractId = parse(UuidSchema, (request.params as { contractId?: unknown }).contractId);
    const input = parse(TaskContractQuerySchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"] ?? contractId);
    const result = await taskContracts.launchTaskContract(contractId, input.projectId, requestOperator(request as { operator?: OperatorContext }), commandId);
    return reply.status(200).send(TaskContractSchema.parse(result));
  });

  app.get("/v1/models", async (request, reply) => {
    const models = await conversations.listModels(requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(models.map((model) => ModelCatalogEntrySchema.parse(model)));
  });

  app.post("/v1/conversations", async (request, reply) => {
    const input = parse(CreateConversationInputSchema, request.body);
    const conversation = await conversations.create(input, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(ConversationSchema.parse(conversation));
  });

  app.get("/v1/conversations/:conversationId", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const query = parse(GoalQuerySchema, request.query);
    const conversation = await conversations.get(conversationId, query.projectId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(ConversationSchema.parse(conversation));
  });

  app.post("/v1/conversations/:conversationId/turns", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const input = parse(ConversationTurnInputSchema, request.body);
    const result = await conversations.turn(conversationId, input, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(ConversationTurnResultSchema.parse(result));
  });

  app.post("/v1/conversations/:conversationId/cancel", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const query = parse(GoalQuerySchema, request.body);
    const result = await conversations.cancel(conversationId, query.projectId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(ConversationSchema.parse(result));
  });

  app.get("/v1/conversations/:conversationId/events/stream", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const query = parse(ConversationEventQuerySchema, request.query);
    const operator = requestOperator(request as { operator?: OperatorContext });
    let cursor = query.after;
    let closed = false;
    let pollTimer: unknown;
    let heartbeatTimer: unknown;
    let polling = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (pollTimer !== undefined) pollingScheduler.clearInterval(pollTimer);
      if (heartbeatTimer !== undefined) pollingScheduler.clearInterval(heartbeatTimer);
      activeStreams.delete(terminate);
    };
    const terminate = () => { if (closed) return; if (!reply.raw.writableEnded) reply.raw.end(); cleanup(); };
    if (activeStreams.size >= maxActiveStreams) throw new Error("SSE stream capacity reached");
    request.raw.once("aborted", cleanup); reply.raw.once("close", cleanup); activeStreams.add(terminate);
    const write = (listed: import("@maestro/contracts").ConversationEvent[]) => {
      for (const event of listed) { if (closed) return; cursor = event.cursor; reply.raw.write(`id: ${event.cursor}\nevent: conversation-event\ndata: ${JSON.stringify(ConversationEventSchema.parse(event))}\n\n`); }
    };
    let initial: readonly import("@maestro/contracts").ConversationEvent[];
    try { initial = await conversations.listEvents(conversationId, query.projectId, cursor, operator); }
    catch { cleanup(); throw new DurableStoreUnavailableError(); }
    if (closed) return reply;
    reply.hijack(); reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" }); reply.raw.flushHeaders(); write([...initial]);
    const poll = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const listed = await conversations.listEvents(conversationId, query.projectId, cursor, operator);
        // The durable cursor is the deduplication key. A reconnect or a repeated
        // poll can never emit an event that is not strictly newer than `cursor`.
        write([...listed].filter((event) => BigInt(event.cursor) > BigInt(cursor)));
      } catch {
        terminate();
      } finally { polling = false; }
    };
    pollTimer = pollingScheduler.setInterval(() => { void poll(); }, 250);
    heartbeatTimer = pollingScheduler.setInterval(() => { if (!closed) reply.raw.write(": heartbeat\n\n"); }, 15_000);
    if (!closed) reply.raw.write(": heartbeat\n\n");
    return reply;
  });

  app.get("/v1/goals", async (request, reply) => {
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(GoalListSchema.parse({ goals: await readState.listGoals(query.projectId) }));
  });

  app.get("/v1/goals/:goalId/budget", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(GoalBudgetSummarySchema.parse(await readState.getBudgetSummary(goalId, query.projectId)));
  });

  app.get("/v1/goals/:goalId", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    const result = await goalService.getGoal(goalId, query.projectId);
    return reply.status(200).send(GoalResultSchema.parse(result));
  });

  app.get("/v1/goals/:goalId/metronome-challenges", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(MetronomeChallengeListSchema.parse({ challenges: await readState.listMetronomeChallenges(goalId, query.projectId) }));
  });
  app.get("/v1/goals/:goalId/encore-council-rounds", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(EncoreCouncilRoundListSchema.parse({ rounds: await readState.listEncoreCouncilRounds(goalId, query.projectId) }));
  });
  app.get("/v1/goals/:goalId/certifications", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(CertificationListSchema.parse({ certifications: await readState.listCertifications(goalId, query.projectId) }));
  });
  app.get("/v1/goals/:goalId/concertmaster-report", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    const report = await readState.getConcertmasterReport(goalId, query.projectId);
    if (!report) throw new GoalNotFoundError();
    return reply.send(ConcertmasterFinalReportSchema.parse(report));
  });
  app.get("/v1/goals/:goalId/git/integration-state", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(GoalGitIntegrationStateSchema.parse(await readState.getGitIntegrationState(goalId, query.projectId)));
  });
  app.get("/v1/goals/:goalId/workers", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(WorkerListSchema.parse({ workers: await readState.listWorkersForGoal(goalId, query.projectId) }));
  });
  app.get("/v1/goals/:goalId/improvement-digests", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    return reply.send(ImprovementDigestListSchema.parse({ digests: await readState.listImprovementDigestsForGoal(goalId, query.projectId, operatorId) }));
  });
  // Ingests one authenticated Discord watchdog signal. Bearer authentication (above) proves the
  // caller holds a real operator credential; the signal's own HMAC signature (verified inside
  // `discordSignal.record`) additionally proves it was genuinely produced by the configured
  // Discord watchdog source, not merely by any authenticated operator.
  app.post("/v1/discord/signals", async (request, reply) => {
    const input = parse(AuthenticatedDiscordSignalSchema, request.body);
    const stored = await discordSignal.record(input);
    return reply.status(201).send(StoredDiscordSignalSchema.parse(stored));
  });

  app.get("/v1/events", async (request, reply) => {
    const query = parse(EventQuerySchema, request.query);
    const listed = await events.listEvents(query.projectId, query.after);
    const nextCursor = listed.at(-1)?.cursor ?? query.after;
    return reply.status(200).send(GoalEventPageSchema.parse({ events: listed, nextCursor }));
  });

  app.get("/v1/events/stream", async (request, reply) => {
    const rawQuery = request.query as { projectId?: unknown; after?: unknown };
    const projectId = parse(UuidSchema, rawQuery.projectId);
    const afterFromQuery = rawQuery.after === undefined ? undefined : parse(EventCursorSchema, rawQuery.after);
    const lastEventId = request.headers["last-event-id"];
    const afterFromHeader = lastEventId === undefined ? undefined : parse(EventCursorSchema, lastEventId);
    if (afterFromHeader !== undefined && afterFromQuery !== undefined && afterFromHeader !== afterFromQuery) {
      throw new RequestValidationError();
    }
    let cursor = afterFromHeader ?? afterFromQuery ?? "0";
    let closed = false;
    let polling = false;
    let timer: unknown;
    const streamOperator = (request as typeof request & { operator?: OperatorContext }).operator;
    const streamSecret = bearerSecret(request.headers.authorization);
    const reauthorize = async (): Promise<void> => {
      if (!streamOperator || streamSecret === undefined) throw new AuthenticationRequiredError();
      const authentication = await authenticator.authenticateBearerSecret(streamSecret);
      if (authentication.outcome !== "authenticated" || authentication.operator.operatorId !== streamOperator.operatorId) throw new CredentialForbiddenError();
      await projectMembership?.assertProjectMembership(streamOperator.operatorId, projectId);
    };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (timer !== undefined) pollingScheduler.clearInterval(timer);
      request.raw.off("aborted", cleanup);
      reply.raw.off("close", cleanup);
      activeStreams.delete(terminate);
    };
    // Terminal writers own the response until it has ended. Cleanup only unregisters it.
    const terminate = () => {
      if (closed) return;
      if (!reply.raw.writableEnded) reply.raw.end();
      // An ended SSE response may otherwise leave its keep-alive socket open,
      // which prevents server shutdown from completing.
      if (!reply.raw.destroyed) reply.raw.destroy();
      cleanup();
    };
    if (activeStreams.size >= maxActiveStreams) throw new Error("SSE stream capacity reached");
    request.raw.once("aborted", cleanup);
    reply.raw.once("close", cleanup);
    activeStreams.add(terminate);

    const writeEvents = (listed: import("@maestro/contracts").GoalEvent[]) => {
      for (const event of listed) {
        if (closed) return;
        cursor = event.cursor;
        reply.raw.write(`id: ${event.cursor}\nevent: goal-event\ndata: ${JSON.stringify(event)}\n\n`);
      }
    };
    const fetchAndWrite = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        await reauthorize();
        const listed = await events.listEvents(projectId, cursor);
        if (listed.length === 0 && !closed) reply.raw.write(": heartbeat\n\n");
        else writeEvents(listed);
      } catch {
        if (!closed) {
          // Headers may already be sent. Closing is the only valid SSE failure signal then.
          if (!reply.raw.headersSent) reply.raw.writeHead(503, { "content-type": "application/json" });
          terminate();
        }
      } finally { polling = false; }
    };

    // Prove durable storage is available before committing the streaming response.
    let initial: import("@maestro/contracts").GoalEvent[];
    try { initial = await events.listEvents(projectId, cursor); }
    catch { cleanup(); throw new DurableStoreUnavailableError(); }
    // A client may disconnect while the initial durable read is in flight.
    // In that case cleanup owns the response and this handler must not write.
    if (closed) return reply;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.flushHeaders();
    writeEvents(initial);
    if (!closed) {
      timer = pollingScheduler.setInterval(() => {
        if (closed || polling) return;
        void fetchAndWrite();
      }, 500);
    }
    return reply;
  });

  return app;
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RequestValidationError();
  return parsed.data;
}
function parseDepartmentId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]+$/.test(value)) throw new RequestValidationError();
  return value;
}
function parseItemId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new RequestValidationError();
  return value;
}

function parseCertificationKind(value: unknown): "security" | "safety_compliance" {
  if (value !== "security" && value !== "safety_compliance") throw new RequestValidationError();
  return value;
}

function parsePositiveInteger(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) throw new RequestValidationError();
  return parsed;
}

class RequestValidationError extends Error {}
class AuthenticationRequiredError extends Error {}
class CredentialForbiddenError extends Error {}
class AuthenticationUnavailableError extends Error {}
class CriticalActionDeniedError extends Error {
  constructor(reason: string) { super(`Critical action denied: ${reason}`); }
}
class CriticalActionRequiresApprovalError extends Error {
  constructor(reason: string) { super(`Critical action requires approval: ${reason}`); }
}

function bearerSecret(authorization: string | string[] | undefined): string | undefined {
  if (typeof authorization !== "string") return undefined;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1];
}

function requestOperator(request: { operator?: OperatorContext }): OperatorContext {
  if (!request.operator) throw new AuthenticationRequiredError();
  return request.operator;
}

/**
 * Reads a projectId the request itself already states, without trusting it
 * for anything beyond "which project to check membership for" -- the real
 * UUID/shape validation still happens later via the route's own zod schema.
 * Returns undefined for a route that carries no projectId at all (the four
 * read-state routes), never a fabricated value.
 */
function isProjectAccessProvisioningRoute(url: string): boolean {
  return url === "/v1/admin/project-access" || url.startsWith("/v1/admin/project-access?");
}

function requestProjectId(request: { query?: unknown; body?: unknown }): string | undefined {
  const fromQuery = (request.query as { projectId?: unknown } | undefined)?.projectId;
  const fromBody = (request.body as { projectId?: unknown } | undefined)?.projectId;
  if (typeof fromQuery === "string" && typeof fromBody === "string" && fromQuery !== fromBody) {
    throw new RequestValidationError();
  }
  if (typeof fromQuery === "string") return fromQuery;
  if (typeof fromBody === "string") return fromBody;
  return undefined;
}

function mapError(error: unknown): { status: number; body: StableApiError } {
  if (isMalformedJsonError(error) || error instanceof RequestValidationError) return apiError(400, "validation_error", "Invalid request");
  if (error instanceof AuthenticationRequiredError) return apiError(401, "authentication_required", "Authentication is required");
  if (error instanceof CredentialForbiddenError) return apiError(403, "credential_forbidden", "Credential is not active");
  if (error instanceof AuthenticationUnavailableError) return apiError(429, "authentication_unavailable", "Authentication is temporarily unavailable");
  if (error instanceof TaskContractProjectMismatchError || error instanceof TaskContractProjectBoundaryError || error instanceof CriticalActionProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof CriticalActionGoalNotFoundError) return apiError(404, "goal_not_found", error.message);
  if (error instanceof HeadGoalNotFoundError) return apiError(404, "goal_not_found", "Goal was not found");
  if (error instanceof HeadProjectMismatchError || error instanceof HeadContractMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof HeadActivationCycleError) return apiError(409, "head_activation_cycle", error.message);
  if (error instanceof HeadActivationBindingConflictError || error instanceof HeadActivationRuntimeConflictError || error instanceof HeadActivationRequesterInactiveError) return apiError(409, "head_activation_conflict", error.message);
  if (error instanceof CouncilGoalNotFoundError) return apiError(404, "goal_not_found", error.message);
  if (error instanceof CouncilProjectMismatchError || error instanceof CouncilContractMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof HeadCouncilNotFoundError) return apiError(404, "council_not_found", error.message);
  if (error instanceof CouncilBriefsSealedError) return apiError(409, "council_briefs_sealed", error.message);
  if (error instanceof CouncilProtocolError) return apiError(409, "council_conflict", error.message);
  if (error instanceof DepartmentPlanProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof DepartmentPlanNotFoundError) return apiError(404, "department_plan_not_found", error.message);
  if (error instanceof DepartmentPlanError) return apiError(409, "department_plan_conflict", error.message);
  if (error instanceof MissionBundleProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof MissionBundleNotFoundError) return apiError(404, "mission_bundle_not_found", error.message);
  if (error instanceof MissionBundleError) return apiError(409, "mission_bundle_conflict", error.message);
  if (error instanceof WorkerProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof WorkerCapacityExceededError) return apiError(429, "worker_capacity_exceeded", error.message);
  if (error instanceof WorkerNotFoundError) return apiError(404, "worker_not_found", error.message);
  if (error instanceof WorkerError) return apiError(409, "worker_conflict", error.message);
  if (error instanceof GitProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof GitIntegrationNotFoundError) return apiError(404, "git_integration_not_found", error.message);
  if (error instanceof GitIntegrationError) return apiError(409, "git_integration_conflict", error.message);
  if (error instanceof GitAuthorizationError) return apiError(403, "authority_denied", error.message);
  if (error instanceof GitOperationError) return apiError(409, "git_integration_conflict", error.message);
  if (error instanceof CertificationNotFoundError) return apiError(404, "certification_not_found", error.message);
  if (error instanceof CertificationError) return apiError(409, "certification_conflict", error.message);
  if (error instanceof MetronomeChallengeNotFoundError) return apiError(404, "metronome_not_found", error.message);
  if (error instanceof MetronomeAuthorizationError) return apiError(403, "authority_denied", error.message);
  if (error instanceof MetronomeChallengeError) return apiError(409, "metronome_conflict", error.message);
  if (error instanceof EncoreProjectMismatchError) return apiError(400, "validation_error", error.message);
  if (error instanceof EncoreCouncilError) return apiError(409, "encore_conflict", error.message);
  if (error instanceof DiscordPersistenceError) return apiError(400, "discord_signal_rejected", error.message);

  if (error instanceof ModelGatewayClientError) {
    if (error.code === "model_not_allowed") return apiError(400, "model_not_allowed", error.message);
    return apiError(503, "provider_unavailable", error.message);
  }
  if (error instanceof ConversationNotFoundError) return apiError(404, "conversation_not_found", "Conversation was not found");
  if (error instanceof ConversationConflictError) return apiError(409, "conversation_conflict", error.message);
  if (error instanceof ConversationModelNotAllowedError) return apiError(400, "model_not_allowed", "Requested model is not allowed");
  if (error instanceof ConversationUnavailableError) return apiError(503, "conversation_unavailable", error.message);
  if (error instanceof TaskContractIntegrityError || error instanceof GoalTaskContractIntegrityError) return apiError(503, "task_contract_integrity_error", error.message);
  if (error instanceof TaskContractNotFoundError) return apiError(404, "task_contract_not_found", "Task Contract was not found");
  if (error instanceof TaskContractConflictError) return apiError(409, "task_contract_conflict", error.message);
  if (error instanceof TaskContractVersionConflictError) return apiError(409, "task_contract_version_conflict", error.message);
  if (error instanceof ExactConfirmationRequiredError) return apiError(409, "exact_confirmation_required", error.message);
  if (error instanceof TaskContractIntegrityError || error instanceof GoalTaskContractIntegrityError) return apiError(503, "task_contract_integrity_error", error.message);
  if (error instanceof VersionConflictError) return apiError(409, "version_conflict", error.message);
  if (error instanceof InvalidTransitionError) return apiError(422, "invalid_transition", error.message);
  if (error instanceof GoalNotFoundError || error instanceof ReadStateGoalNotFoundError) return apiError(404, "goal_not_found", "Goal was not found");
  if (error instanceof StaleLeaseError || error instanceof StaleGoalLeaseError) return apiError(409, "stale_lease", error.message);
  if (error instanceof LeaseUnavailableError) return apiError(423, "lease_unavailable", error.message);
  if (error instanceof CommandIdReuseError) return apiError(409, "command_id_reused", error.message);
  if (error instanceof CriticalActionDeniedError) return apiError(403, "critical_action_denied", error.message);
  if (error instanceof CriticalActionRequiresApprovalError) return apiError(409, "critical_action_requires_approval", error.message);
  if (error instanceof CriticalActionApprovalForbiddenError) return apiError(403, "critical_action_approval_forbidden", error.message);
  if (error instanceof CriticalActionApprovalExpiredError) return apiError(400, "validation_error", error.message);
  if (error instanceof CriticalActionApprovalConflictError) return apiError(409, "command_id_reused", error.message);
  if (error instanceof CriticalActionUnavailableError) return apiError(503, "durable_store_unavailable", error.message);
  if (error instanceof DurableStoreUnavailableError) return apiError(503, "durable_store_unavailable", error.message);
  if (error instanceof ProjectAccessAdminRequiredError) return apiError(403, "authority_denied", error.message);
  if (error instanceof ProjectAccessTargetNotFoundError || error instanceof ProjectAccessRoleNotFoundError) return apiError(400, "validation_error", "Invalid project access request");
  if (error instanceof ProjectMembershipRequiredError || error instanceof ProjectRoleRequiredError) return apiError(403, "project_access_forbidden", error.message);
  return apiError(503, "durable_store_unavailable", "Durable store is unavailable");
}

function apiError(status: number, code: StableApiError["error"]["code"], message: string) {
  return { status, body: StableApiErrorSchema.parse({ error: { code, message } }) };
}

function isMalformedJsonError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "FST_ERR_CTP_INVALID_JSON_BODY";
}
