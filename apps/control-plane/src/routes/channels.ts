import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import {
  ChannelSelectorSchema,
  ChannelQuerySchema,
  ChannelMessageInputSchema,
  ChannelMessageSchema,
  ChannelReadSchema,
  UuidSchema,
} from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerChannelRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { channels } = deps;
  app.get("/v1/goals/:goalId/channels/:kind/:channelId", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const params = request.params as { kind?: unknown; channelId?: unknown };
    const selector = parse(ChannelSelectorSchema, { kind: params.kind, channelId: params.channelId });
    const query = parse(ChannelQuerySchema, request.query);
    const result = await channels.get({
      goalId,
      projectId: query.projectId,
      selector,
      operatorId: requestOperator(request as { operator?: OperatorContext }).operatorId,
    });
    return reply.status(200).send(ChannelReadSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/channels/:kind/:channelId/messages", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const params = request.params as { kind?: unknown; channelId?: unknown };
    const selector = parse(ChannelSelectorSchema, { kind: params.kind, channelId: params.channelId });
    const input = parse(ChannelMessageInputSchema, request.body);
    const messageId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await channels.post({
      goalId,
      selector,
      ...input,
      messageId,
      operatorId: requestOperator(request as { operator?: OperatorContext }).operatorId,
    });
    return reply.status(201).send(ChannelMessageSchema.parse(result));
  });
}
