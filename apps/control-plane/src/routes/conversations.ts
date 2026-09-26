import type { FastifyInstance } from "fastify";
import type { ConversationRouteDeps } from "./deps.js";
import {
  UuidSchema,
  ConversationSchema,
  ConversationListQuerySchema,
  ConversationSummarySchema,
  CreateConversationInputSchema,
  ConversationTurnInputSchema,
  ConversationTurnResultSchema,
  ConversationEventSchema,
  ConversationActivityEventSchema,
  ConversationEventQuerySchema,
  EventCursorSchema,
  GoalQuerySchema,
} from "@maestro/contracts";
import { parse, requestOperator, RequestValidationError } from "../server-input.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerConversationRoutes(app: FastifyInstance, deps: ConversationRouteDeps): void {
  const { pollingScheduler, conversations, activeStreams, maxActiveStreams } = deps;
  app.post("/v1/conversations", async (request, reply) => {
    const input = parse(CreateConversationInputSchema, request.body);
    const header = request.headers["idempotency-key"];
    if (typeof header !== "string" || header.trim() === "") throw new RequestValidationError("Idempotency-Key is required");
    const requestId = parse(UuidSchema, header);
    const conversation = await conversations.create(input, requestOperator(request as { operator?: OperatorContext }), requestId);
    return reply.status(201).send(ConversationSchema.parse(conversation));
  });

  app.get("/v1/conversations", async (request, reply) => {
    const query = parse(ConversationListQuerySchema, request.query);
    if (conversations.list === undefined) throw new DurableStoreUnavailableError();
    const sessions = await conversations.list(query.projectId, query.limit, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(sessions.map((session) => ConversationSummarySchema.parse(session)));
  });

  app.get("/v1/conversations/:conversationId", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const query = parse(GoalQuerySchema, request.query);
    const conversation = await conversations.get(
      conversationId,
      query.projectId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(200).send(ConversationSchema.parse(conversation));
  });

  app.post("/v1/conversations/:conversationId/turns", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const input = parse(ConversationTurnInputSchema, request.body);
    const header = request.headers["idempotency-key"];
    if (typeof header !== "string" || header.trim() === "") throw new RequestValidationError("Idempotency-Key is required");
    const requestId = parse(UuidSchema, header);
    const result = await conversations.turn(conversationId, input, requestOperator(request as { operator?: OperatorContext }), requestId);
    return reply.status(200).send(ConversationTurnResultSchema.parse(result));
  });

  app.post("/v1/conversations/:conversationId/cancel", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const query = parse(GoalQuerySchema, request.body);
    const result = await conversations.cancel(conversationId, query.projectId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(ConversationSchema.parse(result));
  });

  app.get("/v1/conversations/:conversationId/events", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const query = parse(ConversationEventQuerySchema, request.query);
    const events = await conversations.listEvents(
      conversationId,
      query.projectId,
      query.after,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(200).send(events.map((event) => ConversationEventSchema.parse(event)));
  });

  app.get("/v1/conversations/:conversationId/events/stream", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const rawQuery = request.query as { projectId?: unknown; after?: unknown };
    const query = parse(ConversationEventQuerySchema, request.query);
    const queryCursor = rawQuery.after === undefined ? undefined : query.after;
    const lastEventId = request.headers["last-event-id"];
    const headerCursor = lastEventId === undefined ? undefined : parse(EventCursorSchema, lastEventId);
    if (queryCursor !== undefined && headerCursor !== undefined && queryCursor !== headerCursor) throw new RequestValidationError();
    const operator = requestOperator(request as { operator?: OperatorContext });
    let cursor = headerCursor ?? queryCursor ?? "0";
    let closed = false;
    let polling = false;
    let backpressured = false;
    let drainListenerInstalled = false;
    const MAX_SSE_BUFFER_BYTES = 1_000_000;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (pollTimer !== undefined) pollingScheduler.clearInterval(pollTimer);
      if (heartbeatTimer !== undefined) pollingScheduler.clearInterval(heartbeatTimer);
      activeStreams.delete(terminate);
    };
    const terminate = () => {
      if (closed) return;
      if (!reply.raw.writableEnded) reply.raw.end();
      cleanup();
    };
    if (activeStreams.size >= maxActiveStreams) throw new Error("SSE stream capacity reached");
    request.raw.once("aborted", cleanup);
    reply.raw.once("close", cleanup);
    activeStreams.add(terminate);
    const write = (listed: import("@maestro/contracts").ConversationEvent[]) => {
      for (const event of listed) {
        if (closed || backpressured) return;
        const payload = `id: ${event.cursor}\nevent: conversation-event\ndata: ${JSON.stringify(ConversationEventSchema.parse(event))}\n\n`;
        if (reply.raw.writableLength + Buffer.byteLength(payload, "utf8") > MAX_SSE_BUFFER_BYTES) {
          terminate();
          return;
        }
        cursor = event.cursor;
        if (!reply.raw.write(payload)) {
          backpressured = true;
          if (!drainListenerInstalled) {
            drainListenerInstalled = true;
            reply.raw.once("drain", () => {
              drainListenerInstalled = false;
              if (closed) return;
              backpressured = false;
              void poll();
            });
          }
        }
      }
    };
    let initial: readonly import("@maestro/contracts").ConversationEvent[];
    try {
      initial = await conversations.listEvents(conversationId, query.projectId, cursor, operator);
    } catch {
      cleanup();
      throw new DurableStoreUnavailableError();
    }
    if (closed) return reply;
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    reply.raw.flushHeaders();
    write([...initial]);
    const poll = async () => {
      if (closed || polling || backpressured) return;
      polling = true;
      try {
        const listed = await conversations.listEvents(conversationId, query.projectId, cursor, operator);
        // The durable cursor is the deduplication key. A reconnect or a repeated
        // poll can never emit an event that is not strictly newer than `cursor`.
        write([...listed].filter((event) => BigInt(event.cursor) > BigInt(cursor)));
      } catch {
        terminate();
      } finally {
        polling = false;
      }
    };
    const pollTimer = pollingScheduler.setInterval(() => {
      void poll();
    }, 250);
    const writeHeartbeat = () => {
      if (closed || backpressured) return;
      const payload = ": heartbeat\n\n";
      if (reply.raw.writableLength + Buffer.byteLength(payload, "utf8") > MAX_SSE_BUFFER_BYTES) {
        terminate();
        return;
      }
      if (!reply.raw.write(payload)) {
        backpressured = true;
        if (!drainListenerInstalled) {
          drainListenerInstalled = true;
          reply.raw.once("drain", () => {
            drainListenerInstalled = false;
            if (closed) return;
            backpressured = false;
            void poll();
          });
        }
      }
    };
    const heartbeatTimer = pollingScheduler.setInterval(writeHeartbeat, 15_000);
    writeHeartbeat();
    return reply;
  });

  app.get("/v1/conversations/:conversationId/activity/stream", async (request, reply) => {
    const conversationId = parse(UuidSchema, (request.params as { conversationId?: unknown }).conversationId);
    const query = parse(GoalQuerySchema, request.query);
    const operator = requestOperator(request as { operator?: OperatorContext });
    if (activeStreams.size >= maxActiveStreams) throw new Error("SSE stream capacity reached");
    let closed = false;
    let ready = false;
    const pending: import("@maestro/contracts").ConversationActivityEvent[] = [];
    let unsubscribe: (() => void) | undefined;
    let heartbeatTimer: ReturnType<typeof pollingScheduler.setInterval> | undefined = undefined;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      if (heartbeatTimer !== undefined) pollingScheduler.clearInterval(heartbeatTimer);
      activeStreams.delete(terminate);
    };
    const terminate = () => {
      if (closed) return;
      if (!reply.raw.writableEnded) reply.raw.end();
      cleanup();
    };
    const writeFrame = (payload: string): void => {
      if (closed) return;
      if (reply.raw.writableLength + Buffer.byteLength(payload, "utf8") > 1_000_000 || !reply.raw.write(payload)) terminate();
    };
    const write = (event: import("@maestro/contracts").ConversationActivityEvent): void => {
      if (closed) return;
      if (!ready) {
        if (pending.length < 32) pending.push(event);
        return;
      }
      writeFrame(`event: conversation-activity\ndata: ${JSON.stringify(ConversationActivityEventSchema.parse(event))}\n\n`);
    };
    request.raw.once("aborted", cleanup);
    reply.raw.once("close", cleanup);
    activeStreams.add(terminate);
    try {
      if (conversations.subscribeActivity === undefined) throw new Error("conversation activity stream is unavailable");
      unsubscribe = await conversations.subscribeActivity(conversationId, query.projectId, operator, write);
    } catch (error) {
      cleanup();
      throw error;
    }
    if (closed) {
      unsubscribe?.();
      return reply;
    }
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    reply.raw.flushHeaders();
    ready = true;
    for (const event of pending.splice(0)) write(event);
    heartbeatTimer = pollingScheduler.setInterval(() => writeFrame(": heartbeat\n\n"), 15_000);
    return reply;
  });
}
