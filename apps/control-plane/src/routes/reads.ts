import type { FastifyInstance } from "fastify";
import type { ReadRouteDeps } from "./deps.js";
import {
  ArrangementsReadSchema,
  GoalBudgetSummarySchema,
  BillingReadModelSchema,
  CertificationListSchema,
  ConcertmasterFinalReportSchema,
  UuidSchema,
  EncoreCouncilRoundListSchema,
  GoalGitIntegrationStateSchema,
  GoalQuerySchema,
  GoalListSchema,
  GoalPlanReadSchema,
  GoalPlanDecisionInputSchema,
  MetronomeChallengeListSchema,
  ProjectionReadModelSchema,
  ProjectionQuerySchema,
  EvidenceBundleReadSchema,
  ImprovementDigestListSchema,
  WorkerListSchema,
} from "@maestro/contracts";
import { parse, requestOperator, RequestValidationError } from "../server-input.js";
import { DurableStoreUnavailableError, GoalNotFoundError } from "../goal-service.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerReadRoutes(app: FastifyInstance, deps: ReadRouteDeps): void {
  const { concertmasterReports, readState, projections, planDecisions } = deps;
  app.get("/v1/goals", async (request, reply) => {
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(GoalListSchema.parse({ goals: await readState.listGoals(query.projectId) }));
  });

  app.get("/v1/billing", async (request, reply) => {
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(BillingReadModelSchema.parse(await readState.getBillingSummary(query.projectId)));
  });

  app.get("/v1/projection", async (request, reply) => {
    const query = parse(ProjectionQuerySchema, request.query);
    if (query.projectId === undefined) throw new RequestValidationError();
    return reply.send(ProjectionReadModelSchema.parse(await projections.read(query)));
  });

  app.get("/v1/goals/:goalId/budget", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(GoalBudgetSummarySchema.parse(await readState.getBudgetSummary(goalId, query.projectId)));
  });

  app.get("/v1/goals/:goalId/metronome-challenges", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(MetronomeChallengeListSchema.parse({ challenges: await readState.listMetronomeChallenges(goalId, query.projectId) }));
  });
  app.get("/v1/goals/:goalId/encore-council-rounds", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(EncoreCouncilRoundListSchema.parse({ rounds: await readState.listEncoreCouncilRounds(goalId, query.projectId) }));
  });
  app.get("/v1/goals/:goalId/certifications", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(CertificationListSchema.parse({ certifications: await readState.listCertifications(goalId, query.projectId) }));
  });
  app.post("/v1/goals/:goalId/concertmaster-report", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(GoalQuerySchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const report = await concertmasterReports.generate(
      goalId,
      input.projectId,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(201).send(ConcertmasterFinalReportSchema.parse(report));
  });

  app.get("/v1/goals/:goalId/concertmaster-report", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    const report = await readState.getConcertmasterReport(goalId, query.projectId);
    if (!report) throw new GoalNotFoundError();
    return reply.send(ConcertmasterFinalReportSchema.parse(report));
  });
  app.get("/v1/goals/:goalId/evidence-bundle", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(EvidenceBundleReadSchema.parse(await readState.getEvidenceBundle(goalId, query.projectId)));
  });
  app.get("/v1/goals/:goalId/git/integration-state", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(GoalGitIntegrationStateSchema.parse(await readState.getGitIntegrationState(goalId, query.projectId)));
  });
  app.get("/v1/goals/:goalId/workers", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(WorkerListSchema.parse({ workers: await readState.listWorkersForGoal(goalId, query.projectId) }));
  });
  app.get("/v1/goals/:goalId/improvement-digests", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    return reply.send(
      ImprovementDigestListSchema.parse({ digests: await readState.listImprovementDigestsForGoal(goalId, query.projectId, operatorId) }),
    );
  });
  app.get("/v1/goals/:goalId/arrangements", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    return reply.send(ArrangementsReadSchema.parse(await readState.listArrangementsForGoal(goalId, query.projectId, operatorId)));
  });
  app.get("/v1/goals/:goalId/plan", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const query = parse(GoalQuerySchema, request.query);
    return reply.send(GoalPlanReadSchema.parse({ plan: await readState.getGoalPlan(goalId, query.projectId) }));
  });
  app.post("/v1/goals/:goalId/plan/decision", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(GoalPlanDecisionInputSchema, request.body);
    if (planDecisions === undefined) throw new DurableStoreUnavailableError();
    await planDecisions.decide(goalId, input, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(204).send();
  });
}
