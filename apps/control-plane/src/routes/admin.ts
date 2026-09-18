import type { FastifyInstance } from "fastify";
import type { AdminRouteDeps } from "./deps.js";
import {
  ProjectAccessProvisionInputSchema,
  ProjectAccessProvisionResultSchema,
} from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  const { projectAccess } = deps;
  app.post("/v1/admin/project-access", async (request, reply) => {
    if (!projectAccess) throw new DurableStoreUnavailableError();
    const input = parse(ProjectAccessProvisionInputSchema, request.body);
    const result = await projectAccess.provisionProjectAccess(requestOperator(request as { operator?: OperatorContext }).operatorId, input);
    return reply.status(200).send(ProjectAccessProvisionResultSchema.parse(result));
  });
}
