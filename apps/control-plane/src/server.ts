import Fastify, { type FastifyInstance } from "fastify";
import type { OperatorAuthentication, OperatorContext } from "@maestro/persistence";
import { ProjectMembershipRequiredError } from "@maestro/persistence";
import {
  CreateGoalInputSchema,
  CriticalActionInputSchema,
  CriticalActionResultSchema,
  GoalQuerySchema,
  GoalResultSchema,
  SentinelChallengeListSchema,
  EncoreCouncilRoundListSchema,
  CertificationListSchema,
  SaneFinalReportSchema,
  EventQuerySchema,
  EventCursorSchema,
  GoalEventPageSchema,
  type EventCursor,
  StableApiErrorSchema,
  TransitionGoalInputSchema,
  UuidSchema,
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
  type GoalService,
} from "./goal-service.js";
import { CriticalActionUnavailableError, type CriticalActionService } from "./critical-action-service.js";
import type { ReadStateService } from "./read-state-service.js";

export type { GoalService } from "./goal-service.js";
export type { CriticalActionService } from "./critical-action-service.js";

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

export function buildServer({ goalService, authenticator, eventService, criticalActionService, pollingScheduler = systemPollingScheduler, readStateService, https, projectMembership }: {
  goalService: GoalService;
  authenticator: OperatorAuthenticator;
  eventService?: EventService;
  criticalActionService?: CriticalActionService;
  pollingScheduler?: PollingScheduler;
  readStateService?: ReadStateService;
  /** When set, the listener is real HTTPS, not plain HTTP. */
  https?: { cert: Buffer; key: Buffer };
  /**
   * When set, every request that carries a projectId (body or query) is
   * checked against durable project membership before its route handler
   * runs. Optional only so existing tests/composition that do not yet
   * exercise membership can omit it without inventing a fake always-allow
   * checker; production composition (main.ts) always supplies a real one.
   * Routes with no projectId field at all (the four read-state routes) are
   * not covered here -- a separate, already-tracked gap (Phase 3 item 6).
   */
  projectMembership?: ProjectMembershipChecker;
}): FastifyInstance {
  const app: FastifyInstance = https
    ? (Fastify({ https }) as unknown as FastifyInstance)
    : Fastify();
  const activeStreams = new Set<() => void>();
  const events = eventService ?? { listEvents: async () => { throw new DurableStoreUnavailableError(); } };
  const readState = readStateService ?? { listSentinelChallenges: async () => { throw new DurableStoreUnavailableError(); }, listEncoreCouncilRounds: async () => { throw new DurableStoreUnavailableError(); }, listCertifications: async () => { throw new DurableStoreUnavailableError(); }, getSaneReport: async () => { throw new DurableStoreUnavailableError(); } };
  const criticalActions = criticalActionService ?? {
    performCriticalAction: async () => { throw new CriticalActionUnavailableError(); },
  };
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

  app.post("/v1/goals", async (request, reply) => {
    const input = parse(CreateGoalInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await goalService.createGoal(input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(GoalResultSchema.parse(result));
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

  app.get("/v1/goals/:goalId", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    const result = await goalService.getGoal(goalId, query.projectId);
    return reply.status(200).send(GoalResultSchema.parse(result));
  });

  app.get("/v1/goals/:goalId/sentinel-challenges", async (request, reply) => { const goalId=parse(UuidSchema,(request.params as {goalId?:unknown}).goalId); return reply.send(SentinelChallengeListSchema.parse({challenges: await readState.listSentinelChallenges(goalId)})); });
  app.get("/v1/goals/:goalId/encore-council-rounds", async (request, reply) => { const goalId=parse(UuidSchema,(request.params as {goalId?:unknown}).goalId); return reply.send(EncoreCouncilRoundListSchema.parse({rounds: await readState.listEncoreCouncilRounds(goalId)})); });
  app.get("/v1/goals/:goalId/certifications", async (request, reply) => { const goalId=parse(UuidSchema,(request.params as {goalId?:unknown}).goalId); return reply.send(CertificationListSchema.parse({certifications: await readState.listCertifications(goalId)})); });
  app.get("/v1/goals/:goalId/sane-report", async (request, reply) => { const goalId=parse(UuidSchema,(request.params as {goalId?:unknown}).goalId); const report=await readState.getSaneReport(goalId); if (!report) throw new GoalNotFoundError(); return reply.send(SaneFinalReportSchema.parse(report)); });

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
    timer = pollingScheduler.setInterval(() => {
      if (closed || polling) return;
      void fetchAndWrite();
    }, 500);
    return reply;
  });

  return app;
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RequestValidationError();
  return parsed.data;
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
  if (typeof fromQuery === "string") return fromQuery;
  const fromBody = (request.body as { projectId?: unknown } | undefined)?.projectId;
  if (typeof fromBody === "string") return fromBody;
  return undefined;
}

function mapError(error: unknown): { status: number; body: StableApiError } {
  if (isMalformedJsonError(error) || error instanceof RequestValidationError) return apiError(400, "validation_error", "Invalid request");
  if (error instanceof AuthenticationRequiredError) return apiError(401, "authentication_required", "Authentication is required");
  if (error instanceof CredentialForbiddenError) return apiError(403, "credential_forbidden", "Credential is not active");
  if (error instanceof AuthenticationUnavailableError) return apiError(429, "authentication_unavailable", "Authentication is temporarily unavailable");
  if (error instanceof VersionConflictError) return apiError(409, "version_conflict", error.message);
  if (error instanceof InvalidTransitionError) return apiError(422, "invalid_transition", error.message);
  if (error instanceof GoalNotFoundError) return apiError(404, "goal_not_found", error.message);
  if (error instanceof StaleLeaseError) return apiError(409, "stale_lease", error.message);
  if (error instanceof LeaseUnavailableError) return apiError(423, "lease_unavailable", error.message);
  if (error instanceof CommandIdReuseError) return apiError(409, "command_id_reused", error.message);
  if (error instanceof CriticalActionDeniedError) return apiError(403, "critical_action_denied", error.message);
  if (error instanceof CriticalActionRequiresApprovalError) return apiError(409, "critical_action_requires_approval", error.message);
  if (error instanceof CriticalActionUnavailableError) return apiError(503, "durable_store_unavailable", error.message);
  if (error instanceof DurableStoreUnavailableError) return apiError(503, "durable_store_unavailable", error.message);
  if (error instanceof ProjectMembershipRequiredError) return apiError(403, "project_access_forbidden", error.message);
  return apiError(503, "durable_store_unavailable", "Durable store is unavailable");
}

function apiError(status: number, code: StableApiError["error"]["code"], message: string) {
  return { status, body: StableApiErrorSchema.parse({ error: { code, message } }) };
}

function isMalformedJsonError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "FST_ERR_CTP_INVALID_JSON_BODY";
}
