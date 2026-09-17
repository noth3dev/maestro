import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import {
  UuidSchema,
  HeadParticipationInputSchema,
  HeadParticipationSchema,
  CreateHeadCouncilInputSchema,
  SubmitCouncilBriefInputSchema,
  HeadCouncilDecisionInputSchema,
  HeadCouncilSchema,
  DepartmentPlanSchema,
  CreateDepartmentPlanInputSchema,
  ReviseDepartmentPlanInputSchema,
  GoalQuerySchema,
  MissionBundleSchema,
  CreateMissionBundleInputSchema,
  IssueMissionPersonaOverlayInputSchema,
  MissionPersonaOverlaySchema,
} from "@maestro/contracts";
import { parse, requestOperator, parseDepartmentId, parseItemId, parsePositiveInteger } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerCouncilRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { headParticipations, councils, departmentPlans, missionBundles } = deps;
  app.post("/v1/goals/:goalId/head-participations", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(HeadParticipationInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const participation = await headParticipations.activate(
      goalId,
      input,
      requestOperator(request as { operator?: OperatorContext }),
      commandId,
    );
    return reply.status(200).send(HeadParticipationSchema.parse(participation));
  });

  app.post("/v1/goals/:goalId/councils", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(CreateHeadCouncilInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const council = await councils.create(goalId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(HeadCouncilSchema.parse(council));
  });

  app.get("/v1/councils/:councilId", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.status(200).send(HeadCouncilSchema.parse(await councils.get(councilId, query.projectId)));
  });

  app.post("/v1/councils/:councilId/briefs/:departmentId", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const departmentId = parseDepartmentId((request.params as { departmentId?: unknown }).departmentId);
    const input = parse(SubmitCouncilBriefInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    await councils.submitBrief(councilId, departmentId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(204).send();
  });

  app.post("/v1/councils/:councilId/reveal", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const input = parse(GoalQuerySchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    await councils.reveal(councilId, input.projectId, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(204).send();
  });

  app.post("/v1/councils/:councilId/decision", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const input = parse(HeadCouncilDecisionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const council = await councils.decide(councilId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(HeadCouncilSchema.parse(council));
  });

  app.post("/v1/councils/:councilId/departments/:departmentId/plan", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const departmentId = parseDepartmentId((request.params as { departmentId?: unknown }).departmentId);
    const input = parse(CreateDepartmentPlanInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const plan = await departmentPlans.create(
      councilId,
      departmentId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(201).send(DepartmentPlanSchema.parse(plan));
  });

  app.get("/v1/councils/:councilId/departments/:departmentId/plan", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const departmentId = parseDepartmentId((request.params as { departmentId?: unknown }).departmentId);
    const query = parse(GoalQuerySchema, request.query);
    const plan = await departmentPlans.get(councilId, departmentId, query.projectId);
    return reply.status(200).send(DepartmentPlanSchema.parse(plan));
  });

  app.put("/v1/councils/:councilId/departments/:departmentId/plan", async (request, reply) => {
    const councilId = parse(UuidSchema, (request.params as { councilId?: unknown }).councilId);
    const departmentId = parseDepartmentId((request.params as { departmentId?: unknown }).departmentId);
    const input = parse(ReviseDepartmentPlanInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const plan = await departmentPlans.revise(
      councilId,
      departmentId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(200).send(DepartmentPlanSchema.parse(plan));
  });

  app.post("/v1/councils/:councilId/departments/:departmentId/mission-bundles/:itemId", async (request, reply) => {
    const params = request.params as { councilId?: unknown; departmentId?: unknown; itemId?: unknown };
    const councilId = parse(UuidSchema, params.councilId);
    const departmentId = parseDepartmentId(params.departmentId);
    const itemId = parseItemId(params.itemId);
    const input = parse(CreateMissionBundleInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const bundle = await missionBundles.create(
      councilId,
      departmentId,
      itemId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(201).send(MissionBundleSchema.parse(bundle));
  });

  app.get("/v1/councils/:councilId/departments/:departmentId/mission-bundles/:itemId", async (request, reply) => {
    const params = request.params as { councilId?: unknown; departmentId?: unknown; itemId?: unknown };
    const councilId = parse(UuidSchema, params.councilId);
    const departmentId = parseDepartmentId(params.departmentId);
    const itemId = parseItemId(params.itemId);
    const query = request.query as { projectId?: unknown; planVersion?: unknown };
    const projectId = parse(UuidSchema, query.projectId);
    const planVersion = parsePositiveInteger(query.planVersion);
    const bundle = await missionBundles.get(councilId, departmentId, planVersion, itemId, projectId);
    return reply.status(200).send(MissionBundleSchema.parse(bundle));
  });

  app.post("/v1/councils/:councilId/departments/:departmentId/mission-bundles/:itemId/persona-overlay", async (request, reply) => {
    const params = request.params as { councilId?: unknown; departmentId?: unknown; itemId?: unknown };
    const councilId = parse(UuidSchema, params.councilId);
    const departmentId = parseDepartmentId(params.departmentId);
    const itemId = parseItemId(params.itemId);
    const input = parse(IssueMissionPersonaOverlayInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const overlay = await missionBundles.issuePersonaOverlay(
      councilId,
      departmentId,
      itemId,
      input.planVersion,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(201).send(MissionPersonaOverlaySchema.parse(overlay));
  });
}
