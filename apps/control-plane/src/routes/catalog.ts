import type { FastifyInstance } from "fastify";
import type { CatalogRouteDeps } from "./deps.js";
import { ProjectListSchema, OrganizationReadModelSchema, ModelCatalogEntrySchema } from "@maestro/contracts";
import { requestOperator } from "../server-input.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerCatalogRoutes(app: FastifyInstance, deps: CatalogRouteDeps): void {
  const { projectDiscovery, organizations, conversations } = deps;
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
