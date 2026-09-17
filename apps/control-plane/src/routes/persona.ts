import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import { UuidSchema, PersonaInspectionSchema, PersonaReadQuerySchema, PersonaProposalInputSchema } from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerPersonaRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { personaInspection } = deps;
  app.get("/v1/persona", async (request, reply) => {
    const query = parse(PersonaReadQuerySchema, request.query);
    const model = await personaInspection.read(query, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(PersonaInspectionSchema.parse(model));
  });

  app.post("/v1/persona/proposals", async (request, reply) => {
    const input = parse(PersonaProposalInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await personaInspection.propose(input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(result);
  });

  app.post("/v1/persona/candidates/:candidateId/edits", async (request, reply) => {
    const candidateId = parse(UuidSchema, (request.params as { candidateId?: unknown }).candidateId);
    const input = parse(PersonaProposalInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await personaInspection.edit(candidateId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(result);
  });
}
