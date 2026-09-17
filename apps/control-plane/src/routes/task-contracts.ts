import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import {
  UuidSchema,
  TaskContractSchema,
  CreateTaskContractInputSchema,
  UpdateTaskContractInputSchema,
  TaskContractQuerySchema,
  OvertureSelectionInputSchema,
  TaskContractConfirmationInputSchema,
  OvertureRoleSelectionResultSchema,
} from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerTaskContractRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { taskContracts } = deps;
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
    const result = await taskContracts.updateTaskContract(
      contractId,
      input,
      requestOperator(request as { operator?: OperatorContext }),
      commandId,
    );
    return reply.status(200).send(TaskContractSchema.parse(result));
  });

  app.post("/v1/task-contracts/:contractId/overture-selection", async (request, reply) => {
    const contractId = parse(UuidSchema, (request.params as { contractId?: unknown }).contractId);
    const input = parse(OvertureSelectionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"] ?? contractId);
    const roles = await taskContracts.selectOvertureRoles(
      contractId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
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
    const result = await taskContracts.launchTaskContract(
      contractId,
      input.projectId,
      requestOperator(request as { operator?: OperatorContext }),
      commandId,
    );
    return reply.status(200).send(TaskContractSchema.parse(result));
  });
}
