import Fastify, { type FastifyInstance } from "fastify";
import type { OperatorAuthentication, OperatorContext } from "@maestro/persistence";
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
import { ProjectMembershipRequiredError, ProjectRoleRequiredError } from "@maestro/persistence";
import {
  CreateGoalInputSchema,
  CriticalActionInputSchema,
  CriticalActionApprovalInputSchema,
  CriticalActionResultSchema,
  GoalQuerySchema,
  GoalListSchema,
  GoalBudgetSummarySchema,
  GoalResultSchema,
  MetronomeChallengeListSchema,
  EncoreCouncilRoundListSchema,
  CertificationListSchema,
  ConcertmasterFinalReportSchema,
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
  TransitionGoalInputSchema,
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
import { WorkerProjectMismatchError, type WorkerService } from "./worker-service.js";
import { WorkerError, WorkerNotFoundError } from "@maestro/persistence";
import { GitProjectMismatchError, type GitIntegrationService } from "./git-integration-service.js";
import type { CertificationService } from "./certification-service.js";
import type { MetronomeService } from "./metronome-service.js";
import { EncoreProjectMismatchError, type EncoreService } from "./encore-service.js";
import { GitIntegrationError, GitIntegrationNotFoundError, CertificationError, CertificationNotFoundError, MetronomeChallengeError, MetronomeChallengeNotFoundError, MetronomeAuthorizationError, EncoreCouncilError, StaleGoalLeaseError, HeadActivationRequesterInactiveError } from "@maestro/persistence";
import { GitAuthorizationError } from "@maestro/git-adapter";

export interface ReadStateUnavailableService extends ReadStateService {}

export interface EventService {
  listEvents(projectId: string, after: EventCursor): Promise<import("@maestro/contracts").GoalEvent[]>;
}

export interface OperatorAuthenticator {
  authenticateBearerSecret(secret: string): Promise<OperatorAuthentication>;
}

export class ProjectAccessForbiddenError extends Error {}

export interface ProjectMembershipChecker {
  /** Fails closed unless the operator currently holds an active membership for this exact project. */
  assertProjectMembership(operatorId: string, projectId: string): Promise<void>;
}

export interface PollingScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemPollingScheduler: PollingScheduler = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export function buildServer({ goalService, authenticator, eventService, criticalActionService, pollingScheduler = systemPollingScheduler, readStateService, taskContractService, headParticipationService, councilService, departmentPlanService, missionBundleService, workerService, gitIntegrationService, certificationService, metronomeService, encoreService, https, projectMembership, readinessCheck }: {
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
  /** Dependency probe used by /readyz. Liveness never calls this check. */
  readinessCheck?: () => Promise<void>;
}): FastifyInstance {
  const app: FastifyInstance = https
    ? (Fastify({ https }) as unknown as FastifyInstance)
    : Fastify();
  const activeStreams = new Set<() => void>();
  const maxActiveStreams = 128;
  const events = eventService ?? { listEvents: async () => { throw new DurableStoreUnavailableError(); } };
  const readState = readStateService ?? {
    listGoals: async () => { throw new DurableStoreUnavailableError(); },
    getBudgetSummary: async () => { throw new DurableStoreUnavailableError(); },
    listMetronomeChallenges: async () => { throw new DurableStoreUnavailableError(); },
    listEncoreCouncilRounds: async () => { throw new DurableStoreUnavailableError(); },
    listCertifications: async () => { throw new DurableStoreUnavailableError(); },
    getConcertmasterReport: async () => { throw new DurableStoreUnavailableError(); },
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
  } satisfies MetronomeService;
  const encore = encoreService ?? { review: async () => { throw new DurableStoreUnavailableError(); } } satisfies EncoreService;
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
    if (!request.url.startsWith("/v1/") || !projectMembership) return;
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
  if (error instanceof ProjectMembershipRequiredError || error instanceof ProjectRoleRequiredError) return apiError(403, "project_access_forbidden", error.message);
  return apiError(503, "durable_store_unavailable", "Durable store is unavailable");
}

function apiError(status: number, code: StableApiError["error"]["code"], message: string) {
  return { status, body: StableApiErrorSchema.parse({ error: { code, message } }) };
}

function isMalformedJsonError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "FST_ERR_CTP_INVALID_JSON_BODY";
}
