import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import {
  UuidSchema,
  CreateGoalInputSchema,
  TransitionGoalInputSchema,
  GoalControlInputSchema,
  GoalQuerySchema,
  GoalResultSchema,
} from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerGoalRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { goalService } = deps;
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
    const result = await goalService.emergencyStopGoal(
      goalId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(200).send(GoalResultSchema.parse(result));
  });

  app.get("/v1/goals/:goalId", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    const result = await goalService.getGoal(goalId, query.projectId);
    return reply.status(200).send(GoalResultSchema.parse(result));
  });
}
