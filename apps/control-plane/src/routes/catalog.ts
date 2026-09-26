import type { FastifyInstance } from "fastify";
import type { CatalogRouteDeps } from "./deps.js";
import { ProjectListSchema, OrganizationReadModelSchema, ModelCatalogEntrySchema, ProjectCatalogSchema, ProjectNameInputSchema, ProjectSummarySchema, UuidSchema } from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerCatalogRoutes(app: FastifyInstance, deps: CatalogRouteDeps): void {
  const { projectDiscovery, organizations, conversations } = deps;
  app.get("/v1/projects", async (request, reply) => {
    if (!projectDiscovery) throw new DurableStoreUnavailableError();
    const projects = await projectDiscovery.listProjects(requestOperator(request as { operator?: OperatorContext }).operatorId);
    return reply.status(200).send(ProjectListSchema.parse({ projects }));
  });

  app.get("/v1/projects/catalog", async (request, reply) => {
    if (projectDiscovery?.listCatalog === undefined) throw new DurableStoreUnavailableError();
    const projects = await projectDiscovery.listCatalog(requestOperator(request as { operator?: OperatorContext }).operatorId);
    return reply.status(200).send(ProjectCatalogSchema.parse({ projects }));
  });

  app.post("/v1/projects", async (request, reply) => {
    if (projectDiscovery?.create === undefined) throw new DurableStoreUnavailableError();
    const input = parse(ProjectNameInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const project = await projectDiscovery.create(requestOperator(request as { operator?: OperatorContext }).operatorId, input.name, commandId);
    return reply.status(201).send(ProjectSummarySchema.parse(project));
  });

  app.patch("/v1/projects/:projectId", async (request, reply) => {
    if (projectDiscovery?.rename === undefined) throw new DurableStoreUnavailableError();
    const projectId = parse(UuidSchema, (request.params as { projectId?: unknown }).projectId);
    const input = parse(ProjectNameInputSchema, request.body);
    const project = await projectDiscovery.rename(requestOperator(request as { operator?: OperatorContext }).operatorId, projectId, input.name);
    return reply.status(200).send(ProjectSummarySchema.parse(project));
  });

  app.get("/v1/organization", async (_request, reply) => {
    return reply.status(200).send(OrganizationReadModelSchema.parse(await organizations.listOrganization()));
  });

  app.get("/v1/models", async (request, reply) => {
    const models = await conversations.listModels(requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(models.map((model) => ModelCatalogEntrySchema.parse(model)));
  });
}
