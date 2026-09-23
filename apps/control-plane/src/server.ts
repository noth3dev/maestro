import { randomUUID } from "node:crypto";
import { mapError } from "./api-error.js";
import Fastify, { type FastifyInstance } from "fastify";
import type { AccountLoginStore, OperatorContext } from "@maestro/persistence";
import type { PersonaInspectionService } from "./persona-inspection-service.js";
import type { RouterCatalogService } from "./composition/router-catalog.js";

import { type GoalService } from "./goal-service.js";
import { type CriticalActionService } from "./critical-action-service.js";
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
import type { OvertureService } from "./overture-service.js";

import { type GitIntegrationService } from "./git-integration-service.js";
import type { CertificationService } from "./certification-service.js";
import type { PersonaGoalEvidenceService } from "./persona-goal-evidence-service.js";
import type { MetronomeService } from "./metronome-service.js";
import { type EncoreService } from "./encore-service.js";
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
import { registerOvertureRoutes } from "./routes/overture.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerReadRoutes } from "./routes/reads.js";
import { registerDiscordRoutes } from "./routes/discord.js";
import { registerEventRoutes } from "./routes/events.js";
import { resolveServiceDefaults } from "./server-defaults.js";

import type {
  ChannelService,
  DiscordSignalService,
  EventService,
  InboxService,
  OperatorAuthenticator,
  OrganizationService,
  PollingScheduler,
  ProjectAccessProvisioner,
  ProjectDiscoveryService,
  ProjectMembershipChecker,
  ProviderCredentialService,
  RouteDeps,
  SettingsService,
} from "./server-ports.js";

const systemPollingScheduler: PollingScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

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
  overture,
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
  overture?: OvertureService;
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
  const {
    channels,
    organizations,
    events,
    projections,
    personaInspection,
    readState,
    criticalActions,
    inbox,
    capabilityApprovals,
    evidenceCapture,
    personaGoalEvidence,
    concertmasterReports,
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
  } = resolveServiceDefaults({
    channelService,
    organizationService,
    eventService,
    projectionService,
    personaInspectionService,
    readStateService,
    criticalActionService,
    inboxService,
    capabilityApprovalService,
    evidenceCaptureService,
    personaGoalEvidenceService,
    concertmasterReportService,
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
    conversationService,
  });
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
    ...(overture === undefined ? {} : { overture }),
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
  registerOvertureRoutes(app, deps);
  registerChannelRoutes(app, deps);
  registerReadRoutes(app, deps);
  registerDiscordRoutes(app, deps);
  registerEventRoutes(app, deps);

  return app;
}
