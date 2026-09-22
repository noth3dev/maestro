import { randomUUID } from "node:crypto";
import { mapError } from "./api-error.js";
import Fastify, { type FastifyInstance } from "fastify";
import type { EventCursor } from "@maestro/contracts";
import type { AccountLoginStore, OperatorAuthentication, OperatorContext } from "@maestro/persistence";
import type { PersonaInspectionService } from "./persona-inspection-service.js";
import type { RouterCatalogService } from "./composition/router-catalog.js";

import { DurableStoreUnavailableError, type GoalService } from "./goal-service.js";
import { CriticalActionUnavailableError, type CriticalActionService } from "./critical-action-service.js";
import { type ReadStateService } from "./read-state-service.js";
import type { ProjectionService } from "./projection-service.js";
import { type TaskContractService } from "./task-contract-service.js";
import { type HeadParticipationService } from "./head-participation-service.js";
import { type CouncilService } from "./council-service.js";

export type { GoalService } from "./goal-service.js";
export type { CriticalActionService } from "./critical-action-service.js";
export type { TaskContractService } from "./task-contract-service.js";
export type { HeadParticipationService } from "./head-participation-service.js";
export type { CouncilService } from "./council-service.js";
export type { CapabilityApprovalService } from "./capability-approval-service.js";
export type { EvidenceCaptureService } from "./evidence-capture-service.js";
export type { ConcertmasterReportService } from "./concertmaster-report-service.js";
export type { PersonaGoalEvidenceService } from "./persona-goal-evidence-service.js";
import { type DepartmentPlanService } from "./department-plan-service.js";
import { type CapabilityApprovalService } from "./capability-approval-service.js";
import { type EvidenceCaptureService } from "./evidence-capture-service.js";
import type { ConcertmasterReportService } from "./concertmaster-report-service.js";
import { type MissionBundleService } from "./mission-bundle-service.js";
import { type WorkerService } from "./worker-service.js";
import { type ConversationService } from "./conversation-service.js";

import { type GitIntegrationService } from "./git-integration-service.js";
import type { CertificationService } from "./certification-service.js";
import type { PersonaGoalEvidenceService } from "./persona-goal-evidence-service.js";
import type { MetronomeService } from "./metronome-service.js";
import { type EncoreService } from "./encore-service.js";
import { type StoredDiscordSignal } from "@maestro/persistence";

import type { AuthenticatedDiscordSignal } from "@maestro/domain";
import {
  AuthenticationRequiredError,
  AuthenticationUnavailableError,
  CredentialForbiddenError,
  bearerSecret,
  isProjectAccessProvisioningRoute,
  requestProjectId,
} from "./server-input.js";
import { registerCapabilityRoutes } from "./routes/capability.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerRouterRoutes } from "./routes/router.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerPersonaRoutes } from "./routes/persona.js";
import { registerGoalRoutes } from "./routes/goals.js";
import { registerCouncilRoutes } from "./routes/councils.js";
import { registerWorkerRoutes } from "./routes/workers.js";
import { registerOversightRoutes } from "./routes/oversight.js";
import { registerGitRoutes } from "./routes/git.js";
import { registerCriticalActionRoutes } from "./routes/critical-actions.js";
import { registerTaskContractRoutes } from "./routes/task-contracts.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerReadRoutes } from "./routes/reads.js";
import { registerDiscordRoutes } from "./routes/discord.js";
import { registerEventRoutes } from "./routes/events.js";

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

export interface InboxService {
  listPendingApprovals(projectId: string, operator: OperatorContext): Promise<import("@maestro/contracts").InboxRead>;
}

export interface ChannelService {
  get(input: {
    operatorId: string;
    projectId: string;
    goalId: string;
    selector: import("@maestro/domain").ChannelSelector;
  }): Promise<import("@maestro/contracts").ChannelRead>;
  post(input: {
    operatorId: string;
    projectId: string;
    goalId: string;
    selector: import("@maestro/domain").ChannelSelector;
    content: string;
    messageId: string;
  }): Promise<import("@maestro/contracts").ChannelMessage>;
}

export interface OrganizationService {
  /** Returns the standing taxonomy; authentication is enforced by the route hook. */
  listOrganization(): Promise<import("@maestro/contracts").OrganizationReadModel>;
}

export interface ProviderCredentialService {
  bind(input: {
    operatorId: string;
    requestId: string;
    providerId: "openai" | "anthropic";
    authMode: "api-key";
    secret: string;
  }): Promise<import("@maestro/agent-runtime").GatewayCredentialBinding>;
  revoke(input: { operatorId: string; requestId: string; providerId: "openai" | "anthropic" }): Promise<void>;
  list?(): Promise<readonly import("@maestro/contracts").SettingsProvider[]>;
  startAccountLogin?(input: {
    operatorId: string;
    requestId: string;
    providerId: "openai-codex" | "anthropic-claude";
  }): Promise<import("@maestro/agent-runtime").GatewayAccountLoginStartResult>;
  accountLoginStatus?(input: {
    operatorId: string;
    requestId: string;
    providerId: "openai-codex" | "anthropic-claude";
    loginId: string;
  }): Promise<import("@maestro/agent-runtime").GatewayAccountLoginStatusResult>;
  cancelAccountLogin?(input: {
    operatorId: string;
    requestId: string;
    providerId: "openai-codex" | "anthropic-claude";
    loginId: string;
  }): Promise<void>;
  logoutAccount?(input: { operatorId: string; requestId: string; providerId: "openai-codex" | "anthropic-claude" }): Promise<void>;
}

export interface SettingsService {
  get(operatorId: string): Promise<import("@maestro/contracts").SettingsRead>;
  updatePreferences(
    operatorId: string,
    patch: import("@maestro/contracts").SettingsPreferencesUpdate,
  ): Promise<import("@maestro/contracts").SettingsRead>;
  updateModelPool(
    operatorId: string,
    patch: import("@maestro/contracts").SettingsModelPoolUpdate,
  ): Promise<import("@maestro/contracts").SettingsRead>;
  replaceModelPool(
    operatorId: string,
    input: import("@maestro/contracts").SettingsModelPoolConfig,
  ): Promise<import("@maestro/contracts").SettingsRead>;
  updateAuthorityDefaults(
    operatorId: string,
    patch: import("@maestro/contracts").SettingsAuthorityDefaultsUpdate,
  ): Promise<import("@maestro/contracts").SettingsRead>;
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
  provisionProjectAccess(
    requesterOperatorId: string,
    input: import("@maestro/contracts").ProjectAccessProvisionInput,
  ): Promise<import("@maestro/contracts").ProjectAccessProvisionResult>;
}

export interface PollingScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemPollingScheduler: PollingScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface RouteDeps {
  goalService: GoalService;
  events: EventService;
  criticalActions: CriticalActionService;
  capabilityApprovals: Pick<CapabilityApprovalService, "selectFullAccessMode">;
  inbox: InboxService;
  evidenceCapture: EvidenceCaptureService;
  personaGoalEvidence: PersonaGoalEvidenceService;
  concertmasterReports: ConcertmasterReportService;
  pollingScheduler: PollingScheduler;
  readState: ReadStateService;
  taskContracts: TaskContractService;
  headParticipations: HeadParticipationService;
  councils: CouncilService;
  departmentPlans: DepartmentPlanService;
  missionBundles: MissionBundleService;
  workers: WorkerService;
  gitIntegrations: GitIntegrationService;
  certifications: CertificationService;
  metronome: MetronomeService;
  encore: EncoreService;
  discordSignal: DiscordSignalService;
  conversations: ConversationService;
  projections: ProjectionService;
  personaInspection: PersonaInspectionService;
  organizations: OrganizationService;
  channels: ChannelService;
  loginOwnerId: string;
  loginOperationStaleAfterMs: number;
  activeStreams: Set<() => void>;
  maxActiveStreams: number;
  authenticator: OperatorAuthenticator;
  projectAccess?: ProjectAccessProvisioner;
  projectDiscovery?: ProjectDiscoveryService;
  providerCredentials?: ProviderCredentialService;
  accountLoginStore?: AccountLoginStore;
  settingsService?: SettingsService;
  routerCatalogService?: RouterCatalogService;
  projectMembership?: ProjectMembershipChecker;
}

export function buildServer({
  goalService,
  authenticator,
  eventService,
  criticalActionService,
  capabilityApprovalService,
  inboxService,
  evidenceCaptureService,
  personaGoalEvidenceService,
  concertmasterReportService,
  pollingScheduler = systemPollingScheduler,
  readStateService,
  taskContractService,
  headParticipationService,
  councilService,
  departmentPlanService,
  missionBundleService,
  workerService,
  gitIntegrationService,
  certificationService,
  metronomeService,
  encoreService,
  discordSignalService,
  https,
  projectMembership,
  projectAccess,
  projectDiscovery,
  organizationService,
  channelService,
  providerCredentials,
  accountLoginStore,
  accountLoginOwnerId,
  readinessCheck,
  conversationService,
  projectionService,
  settingsService,
  routerCatalogService,
  personaInspectionService,
}: {
  goalService: GoalService;
  authenticator: OperatorAuthenticator;
  eventService?: EventService;
  criticalActionService?: CriticalActionService;
  capabilityApprovalService?: CapabilityApprovalService;
  inboxService?: InboxService;
  evidenceCaptureService?: EvidenceCaptureService;
  personaGoalEvidenceService?: PersonaGoalEvidenceService;
  concertmasterReportService?: ConcertmasterReportService;
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
  /** Authenticated standing organization taxonomy used for first-run orientation. */
  organizationService?: OrganizationService;
  /** Goal-bound Department/organization/Encore channel persistence. */
  channelService?: ChannelService;
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
  /** Durable projection composition over existing source tables for Carnegie panels. */
  projectionService?: ProjectionService;
  settingsService?: SettingsService;
  routerCatalogService?: RouterCatalogService;
  /** Durable learned persona inspection and candidate proposal/edit boundary. */
  personaInspectionService?: PersonaInspectionService;
}): FastifyInstance {
  const app: FastifyInstance = https === undefined ? Fastify() : Fastify({ https });
  const activeStreams = new Set<() => void>();
  const maxActiveStreams = 128;
  const loginOwnerId = accountLoginOwnerId ?? `control-plane-${randomUUID()}`;
  const loginOperationStaleAfterMs = 30_000;
  const channels =
    channelService ??
    ({
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      post: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies ChannelService);
  const organizations =
    organizationService ??
    ({
      listOrganization: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies OrganizationService);
  const events = eventService ?? {
    listEvents: async () => {
      throw new DurableStoreUnavailableError();
    },
  };
  const projections =
    projectionService ??
    ({
      read: async () => {
        throw new DurableStoreUnavailableError();
      },
      compose: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies ProjectionService);
  const personaInspection =
    personaInspectionService ??
    ({
      read: async () => {
        throw new DurableStoreUnavailableError();
      },
      propose: async () => {
        throw new DurableStoreUnavailableError();
      },
      edit: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies PersonaInspectionService);
  const readState = readStateService ?? {
    listGoals: async () => {
      throw new DurableStoreUnavailableError();
    },
    getBudgetSummary: async () => {
      throw new DurableStoreUnavailableError();
    },
    getBillingSummary: async () => {
      throw new DurableStoreUnavailableError();
    },
    listMetronomeChallenges: async () => {
      throw new DurableStoreUnavailableError();
    },
    listEncoreCouncilRounds: async () => {
      throw new DurableStoreUnavailableError();
    },
    listCertifications: async () => {
      throw new DurableStoreUnavailableError();
    },
    getConcertmasterReport: async () => {
      throw new DurableStoreUnavailableError();
    },
    getEvidenceBundle: async () => {
      throw new DurableStoreUnavailableError();
    },
    getGitIntegrationState: async () => {
      throw new DurableStoreUnavailableError();
    },
    listWorkersForGoal: async () => {
      throw new DurableStoreUnavailableError();
    },
    listImprovementDigestsForGoal: async () => {
      throw new DurableStoreUnavailableError();
    },
    listArrangementsForGoal: async () => {
      throw new DurableStoreUnavailableError();
    },
  };
  const criticalActions = criticalActionService ?? {
    performCriticalAction: async () => {
      throw new CriticalActionUnavailableError();
    },
    approveAndPerformCriticalAction: async () => {
      throw new CriticalActionUnavailableError();
    },
    denyCriticalAction: async () => {
      throw new CriticalActionUnavailableError();
    },
  };
  const inbox =
    inboxService ??
    ({
      listPendingApprovals: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies InboxService);
  const capabilityApprovals =
    capabilityApprovalService ??
    ({
      selectFullAccessMode: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies Pick<CapabilityApprovalService, "selectFullAccessMode">);
  const evidenceCapture =
    evidenceCaptureService ??
    ({
      capture: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies EvidenceCaptureService);
  const personaGoalEvidence =
    personaGoalEvidenceService ??
    ({
      capture: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies PersonaGoalEvidenceService);
  const concertmasterReports =
    concertmasterReportService ??
    ({
      generate: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies ConcertmasterReportService);
  const taskContracts =
    taskContractService ??
    ({
      createTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
      getTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
      updateTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
      selectOvertureRoles: async () => {
        throw new DurableStoreUnavailableError();
      },
      confirmTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
      launchTaskContract: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies TaskContractService);
  const headParticipations =
    headParticipationService ??
    ({
      activate: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies HeadParticipationService);
  const councils =
    councilService ??
    ({
      create: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      submitBrief: async () => {
        throw new DurableStoreUnavailableError();
      },
      reveal: async () => {
        throw new DurableStoreUnavailableError();
      },
      decide: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies CouncilService);
  const departmentPlans =
    departmentPlanService ??
    ({
      create: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      revise: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies DepartmentPlanService);
  const missionBundles =
    missionBundleService ??
    ({
      create: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      issuePersonaOverlay: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies MissionBundleService);
  const workers =
    workerService ??
    ({
      spawn: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      observe: async () => {
        throw new DurableStoreUnavailableError();
      },
      sendMessage: async () => {
        throw new DurableStoreUnavailableError();
      },
      cancel: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies WorkerService);
  const gitIntegrations =
    gitIntegrationService ??
    ({
      createGoalBranch: async () => {
        throw new DurableStoreUnavailableError();
      },
      createDepartmentBranch: async () => {
        throw new DurableStoreUnavailableError();
      },
      createWorkerWorktree: async () => {
        throw new DurableStoreUnavailableError();
      },
      advanceWorker: async () => {
        throw new DurableStoreUnavailableError();
      },
      freezeGoalRevision: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies GitIntegrationService);
  const certifications =
    certificationService ??
    ({
      accept: async () => {
        throw new DurableStoreUnavailableError();
      },
      certify: async () => {
        throw new DurableStoreUnavailableError();
      },
      certifyConditional: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies CertificationService);
  const metronome =
    metronomeService ??
    ({
      scan: async () => {
        throw new DurableStoreUnavailableError();
      },
      raise: async () => {
        throw new DurableStoreUnavailableError();
      },
      requestCorrection: async () => {
        throw new DurableStoreUnavailableError();
      },
      requestSafePause: async () => {
        throw new DurableStoreUnavailableError();
      },
      resolve: async () => {
        throw new DurableStoreUnavailableError();
      },
      challengeWorkerOverlay: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies MetronomeService);
  const encore =
    encoreService ??
    ({
      review: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies EncoreService);
  const discordSignal =
    discordSignalService ??
    ({
      record: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies DiscordSignalService);
  const conversations =
    conversationService ??
    ({
      listModels: async () => {
        throw new DurableStoreUnavailableError();
      },
      create: async () => {
        throw new DurableStoreUnavailableError();
      },
      get: async () => {
        throw new DurableStoreUnavailableError();
      },
      turn: async () => {
        throw new DurableStoreUnavailableError();
      },
      cancel: async () => {
        throw new DurableStoreUnavailableError();
      },
      listEvents: async () => {
        throw new DurableStoreUnavailableError();
      },
    } satisfies ConversationService);
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
  const deps: RouteDeps = {
    goalService,
    events,
    criticalActions,
    capabilityApprovals,
    inbox,
    evidenceCapture,
    personaGoalEvidence,
    concertmasterReports,
    pollingScheduler,
    readState,
    taskContracts,
    headParticipations,
    councils,
    departmentPlans,
    missionBundles,
    workers,
    gitIntegrations,
    certifications,
    metronome,
    encore,
    discordSignal,
    conversations,
    projections,
    personaInspection,
    organizations,
    channels,
    loginOwnerId,
    loginOperationStaleAfterMs,
    activeStreams,
    maxActiveStreams,
    authenticator,
    ...(projectAccess === undefined ? {} : { projectAccess }),
    ...(projectDiscovery === undefined ? {} : { projectDiscovery }),
    ...(providerCredentials === undefined ? {} : { providerCredentials }),
    ...(accountLoginStore === undefined ? {} : { accountLoginStore }),
    ...(settingsService === undefined ? {} : { settingsService }),
    ...(routerCatalogService === undefined ? {} : { routerCatalogService }),
    ...(projectMembership === undefined ? {} : { projectMembership }),
  };
  registerCapabilityRoutes(app, deps);
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
  registerAdminRoutes(app, deps);
  registerCatalogRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerRouterRoutes(app, deps);
  registerProviderRoutes(app, deps);
  registerPersonaRoutes(app, deps);
  registerGoalRoutes(app, deps);
  registerCouncilRoutes(app, deps);
  registerWorkerRoutes(app, deps);
  registerOversightRoutes(app, deps);
  registerGitRoutes(app, deps);
  registerCriticalActionRoutes(app, deps);
  registerTaskContractRoutes(app, deps);
  registerConversationRoutes(app, deps);
  registerChannelRoutes(app, deps);
  registerReadRoutes(app, deps);
  registerDiscordRoutes(app, deps);
  registerEventRoutes(app, deps);

  return app;
}
