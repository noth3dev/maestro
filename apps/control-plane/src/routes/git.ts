import type { FastifyInstance } from "fastify";
import type { GitRouteDeps } from "./deps.js";
import {
  WorkerIntegrationInputSchema,
  UuidSchema,
  GoalIntegrationBranchInputSchema,
  DepartmentBranchInputSchema,
  WorkerWorktreeInputSchema,
  GoalIntegrationRevisionSchema,
  GoalIntegrationBranchSchema,
  DepartmentBranchSchema,
  WorkerWorktreeSchema,
  IntegrationCommitSchema,
} from "@maestro/contracts";
import { parse, requestOperator, parseDepartmentId } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerGitRoutes(app: FastifyInstance, deps: GitRouteDeps): void {
  const { gitIntegrations } = deps;
  app.post("/v1/goals/:goalId/git/integration-branch", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(GoalIntegrationBranchInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await gitIntegrations.createGoalBranch(
      goalId,
      input,
      requestOperator(request as { operator?: OperatorContext }).operatorId,
      commandId,
    );
    return reply.status(201).send(GoalIntegrationBranchSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/git/integration-revision", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(DepartmentBranchInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await gitIntegrations.freezeGoalRevision(
      goalId,
      input.projectId,
      requestOperator(request as { operator?: OperatorContext }).operatorId,
      commandId,
    );
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

  app.post("/v1/workers/:workerId/git/advance", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(WorkerIntegrationInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await gitIntegrations.advanceWorker(
      workerId,
      input,
      requestOperator(request as { operator?: OperatorContext }).operatorId,
      commandId,
    );
    return reply.status(201).send(IntegrationCommitSchema.parse(result));
  });
}
