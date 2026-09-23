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
  UuidSchema,
} from "@maestro/contracts";
import { parse, requestOperator, RequestValidationError } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

function requiredCommandId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new RequestValidationError("Idempotency-Key is required");
  return parse(UuidSchema, value);
}

export function registerOvertureRoutes(app: FastifyInstance, deps: OvertureRouteDeps): void {
  const { overture } = deps;
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
}
