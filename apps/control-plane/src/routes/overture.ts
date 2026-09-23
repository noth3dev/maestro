import type { FastifyInstance } from "fastify";
import type { OvertureRouteDeps } from "./deps.js";
import {
  AppendOvertureMessageInputSchema,
  AppendOvertureOperatorMessageBodySchema,
  CreateOvertureRunBodySchema,
  CreateOvertureRunInputSchema,
  OvertureEventQuerySchema,
  OvertureEventSchema,
  OvertureMessageSchema,
  OvertureRunQuerySchema,
  OvertureRunSchema,
  EventCursorSchema,
  UuidSchema,
} from "@maestro/contracts";
import { parse, requestOperator, RequestValidationError } from "../server-input.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

function requiredCommandId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new RequestValidationError("Idempotency-Key is required");
  return parse(UuidSchema, value);
}

export function registerOvertureRoutes(app: FastifyInstance, deps: OvertureRouteDeps): void {
  const { overture, pollingScheduler, activeStreams, maxActiveStreams } = deps;
  if (overture === undefined) return;

  app.post("/v1/overture/runs", async (request, reply) => {
    const commandId = requiredCommandId(request.headers["idempotency-key"]);
    const body = parse(CreateOvertureRunBodySchema, request.body);
    const input = CreateOvertureRunInputSchema.parse({ ...body, commandId });
    const result = await overture.createRun(input, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(OvertureRunSchema.parse(result));
  });

  app.get("/v1/overture/runs/:runId", async (request, reply) => {
    const runId = parse(UuidSchema, (request.params as { runId?: unknown }).runId);
    const query = parse(OvertureRunQuerySchema, request.query);
    const result = await overture.getRun(
      runId,
      query.projectId,
      query.conversationId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(200).send(OvertureRunSchema.parse(result));
  });

  app.post("/v1/overture/runs/:runId/messages", async (request, reply) => {
    const runId = parse(UuidSchema, (request.params as { runId?: unknown }).runId);
    const commandId = requiredCommandId(request.headers["idempotency-key"]);
    const body = parse(AppendOvertureOperatorMessageBodySchema, request.body);
    const input = AppendOvertureMessageInputSchema.parse({ ...body, runId, commandId, actor: "operator", modelRef: null });
    const result = await overture.appendOperatorMessage(input, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(OvertureMessageSchema.parse(result));
  });

  app.get("/v1/overture/runs/:runId/messages", async (request, reply) => {
    const runId = parse(UuidSchema, (request.params as { runId?: unknown }).runId);
    const query = parse(OvertureEventQuerySchema, request.query);
    const result = await overture.listMessages(
      runId,
      query.projectId,
      query.conversationId,
      query.afterCursor,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(200).send(result.map((message) => OvertureMessageSchema.parse(message)));
  });

  app.get("/v1/overture/runs/:runId/events", async (request, reply) => {
    const runId = parse(UuidSchema, (request.params as { runId?: unknown }).runId);
    const query = parse(OvertureEventQuerySchema, request.query);
    const result = await overture.listEvents(
      runId,
      query.projectId,
      query.conversationId,
      query.afterCursor,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(200).send(result.map((event) => OvertureEventSchema.parse(event)));
  });

  app.get("/v1/overture/runs/:runId/events/stream", async (request, reply) => {
    const runId = parse(UuidSchema, (request.params as { runId?: unknown }).runId);
    const rawQuery = request.query as { projectId?: unknown; conversationId?: unknown; afterCursor?: unknown };
    const query = parse(OvertureEventQuerySchema, request.query);
    const queryCursor = rawQuery.afterCursor === undefined ? undefined : query.afterCursor;
    const lastEventId = request.headers["last-event-id"];
    const headerCursor = lastEventId === undefined ? undefined : parse(EventCursorSchema, lastEventId);
    if (queryCursor !== undefined && headerCursor !== undefined && queryCursor !== headerCursor) throw new RequestValidationError();
    const operator = requestOperator(request as { operator?: OperatorContext });
    let cursor = headerCursor ?? queryCursor ?? "0";
    let closed = false;
    let polling = false;
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
    const write = (events: readonly import("@maestro/contracts").OvertureEvent[]) => {
      for (const event of events) {
        if (closed) return;
        const payload = `id: ${event.cursor}\nevent: overture-event\ndata: ${JSON.stringify(OvertureEventSchema.parse(event))}\n\n`;
        if (!reply.raw.write(payload)) {
          terminate();
          return;
        }
        cursor = event.cursor;
      }
    };
    let initial: readonly import("@maestro/contracts").OvertureEvent[];
    try {
      initial = await overture.listEvents(runId, query.projectId, query.conversationId, cursor, operator);
    } catch {
      cleanup();
      throw new DurableStoreUnavailableError();
    }
    if (closed) return reply;
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
    reply.raw.flushHeaders();
    write(initial);
    const poll = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const listed = await overture.listEvents(runId, query.projectId, query.conversationId, cursor, operator);
        write(listed.filter((event) => BigInt(event.cursor) > BigInt(cursor)));
      } catch {
        terminate();
      } finally {
        polling = false;
      }
    };
    const pollTimer = pollingScheduler.setInterval(() => void poll(), 250);
    const writeHeartbeat = () => {
      if (!closed) reply.raw.write(": heartbeat\n\n");
    };
    const heartbeatTimer = pollingScheduler.setInterval(writeHeartbeat, 15_000);
    writeHeartbeat();
    return reply;
  });
}
