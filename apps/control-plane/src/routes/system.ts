import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import {
  ProjectAccessProvisionInputSchema,
  ProjectAccessProvisionResultSchema,
  ProjectListSchema,
  OrganizationReadModelSchema,
  ModelCatalogEntrySchema,
} from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerSystemRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { projectAccess, projectDiscovery, organizations, conversations } = deps;
  app.post("/v1/admin/project-access", async (request, reply) => {
    if (!projectAccess) throw new DurableStoreUnavailableError();
    const input = parse(ProjectAccessProvisionInputSchema, request.body);
    const result = await projectAccess.provisionProjectAccess(requestOperator(request as { operator?: OperatorContext }).operatorId, input);
    return reply.status(200).send(ProjectAccessProvisionResultSchema.parse(result));
  });

  app.get("/v1/projects", async (request, reply) => {
    if (!projectDiscovery) throw new DurableStoreUnavailableError();
    const projects = await projectDiscovery.listProjects(requestOperator(request as { operator?: OperatorContext }).operatorId);
    return reply.status(200).send(ProjectListSchema.parse({ projects }));
  });

  app.get("/v1/organization", async (_request, reply) => {
    return reply.status(200).send(OrganizationReadModelSchema.parse(await organizations.listOrganization()));
  });

  app.get("/v1/models", async (request, reply) => {
    const models = await conversations.listModels(requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(models.map((model) => ModelCatalogEntrySchema.parse(model)));
  });
}
