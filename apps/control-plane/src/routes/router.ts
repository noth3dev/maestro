import type { FastifyInstance } from "fastify";
import type { OperatorContext } from "@maestro/persistence";
import { RouterCatalogReadSchema, RouterConfigInputSchema, RouterConfigValidationSchema } from "@maestro/contracts";
import type { RouterRouteDeps } from "./deps.js";
import { DurableStoreUnavailableError } from "../goal-service.js";
import { parse, requestOperator } from "../server-input.js";

export function registerRouterRoutes(app: FastifyInstance, deps: RouterRouteDeps): void {
  const { routerCatalogService } = deps;

  app.get("/v1/router/catalog", async (request, reply) => {
    if (routerCatalogService === undefined) throw new DurableStoreUnavailableError();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    return reply.status(200).send(RouterCatalogReadSchema.parse(await routerCatalogService.get(operatorId)));
  });

  app.post("/v1/router/config/validate", async (request, reply) => {
    if (routerCatalogService === undefined) throw new DurableStoreUnavailableError();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const input = parse(RouterConfigInputSchema, request.body);
    return reply.status(200).send(RouterConfigValidationSchema.parse(await routerCatalogService.validate(operatorId, input)));
  });

  app.put("/v1/router/config", async (request, reply) => {
    if (routerCatalogService === undefined) throw new DurableStoreUnavailableError();
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const input = parse(RouterConfigInputSchema, request.body);
    return reply.status(200).send(RouterCatalogReadSchema.parse(await routerCatalogService.replace(operatorId, input)));
  });
}
