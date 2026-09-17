import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import {
  CapabilitySessionSelectionInputSchema,
  CapabilitySessionSchema,
  EvidenceCaptureInputSchema,
  EvidenceRecordSchema,
  UuidSchema,
  GoalQuerySchema,
  InboxReadSchema,
} from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerCapabilityRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { capabilityApprovals, inbox, evidenceCapture, personaGoalEvidence } = deps;
  app.get("/v1/inbox", async (request, reply) => {
    const query = parse(GoalQuerySchema, request.query);
    const result = await inbox.listPendingApprovals(query.projectId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(InboxReadSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/capabilities/full-access-mode", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(CapabilitySessionSelectionInputSchema, request.body);
    const operatorContext = requestOperator(request as { operator?: OperatorContext });
    const session = await capabilityApprovals.selectFullAccessMode(
      { ...input, goalId },
      { actorId: operatorContext.operatorId, kind: "user", projectId: input.projectId, goalId, active: true },
    );
    return reply.status(200).send(CapabilitySessionSchema.parse({ ...session, selectedAt: session.selectedAt.toISOString() }));
  });

  app.post("/v1/goals/:goalId/persona-evidence", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const evidence = await personaGoalEvidence.capture(goalId, request.body, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(evidence);
  });

  app.post("/v1/goals/:goalId/evidence-records", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(EvidenceCaptureInputSchema, request.body);
    const record = await evidenceCapture.capture({ ...input, goalId }, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(EvidenceRecordSchema.parse(record));
  });
}
