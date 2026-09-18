import type { FastifyInstance } from "fastify";
import type { EventRouteDeps } from "./deps.js";
import { UuidSchema, EventCursorSchema, EventQuerySchema, GoalEventPageSchema } from "@maestro/contracts";
import { parse, bearerSecret, AuthenticationRequiredError, CredentialForbiddenError, RequestValidationError } from "../server-input.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerEventRoutes(app: FastifyInstance, deps: EventRouteDeps): void {
  const { events, pollingScheduler, activeStreams, maxActiveStreams, authenticator, projectMembership } = deps;
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
    let backpressured = false;
    let drainListenerInstalled = false;
    const MAX_SSE_BUFFER_BYTES = 1_000_000;
    const streamOperator = (request as typeof request & { operator?: OperatorContext }).operator;
    const streamSecret = bearerSecret(request.headers.authorization);
    const reauthorize = async (): Promise<void> => {
      if (!streamOperator || streamSecret === undefined) throw new AuthenticationRequiredError();
      const authentication = await authenticator.authenticateBearerSecret(streamSecret);
      if (authentication.outcome !== "authenticated" || authentication.operator.operatorId !== streamOperator.operatorId)
        throw new CredentialForbiddenError();
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

    const markBackpressure = () => {
      backpressured = true;
      if (!drainListenerInstalled) {
        drainListenerInstalled = true;
        reply.raw.once("drain", () => {
          drainListenerInstalled = false;
          if (closed) return;
          backpressured = false;
          void fetchAndWrite();
        });
      }
    };
    const writeFrame = (payload: string): boolean => {
      if (closed) return false;
      if (reply.raw.writableLength + Buffer.byteLength(payload, "utf8") > MAX_SSE_BUFFER_BYTES) {
        terminate();
        return false;
      }
      if (!reply.raw.write(payload)) markBackpressure();
      return true;
    };
    const writeEvents = (listed: import("@maestro/contracts").GoalEvent[]) => {
      for (const event of listed) {
        if (closed || backpressured) return;
        cursor = event.cursor;
        if (!writeFrame(`id: ${event.cursor}\nevent: goal-event\ndata: ${JSON.stringify(event)}\n\n`)) return;
      }
    };
    const fetchAndWrite = async () => {
      if (closed || polling || backpressured) return;
      polling = true;
      try {
        await reauthorize();
        const listed = await events.listEvents(projectId, cursor);
        if (listed.length === 0 && !closed) writeFrame(": heartbeat\n\n");
        else writeEvents(listed);
      } catch {
        if (!closed) {
          // Headers may already be sent. Closing is the only valid SSE failure signal then.
          if (!reply.raw.headersSent) reply.raw.writeHead(503, { "content-type": "application/json" });
          terminate();
        }
      } finally {
        polling = false;
      }
    };

    // Prove durable storage is available before committing the streaming response.
    let initial: import("@maestro/contracts").GoalEvent[];
    try {
      initial = await events.listEvents(projectId, cursor);
    } catch {
      cleanup();
      throw new DurableStoreUnavailableError();
    }
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
}
