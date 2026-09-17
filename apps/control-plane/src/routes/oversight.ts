import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import {
  UuidSchema,
  EncoreReviewInputSchema,
  EncoreCouncilResultSchema,
  MetronomeChallengeSchema,
  MetronomeFindingListSchema,
  MetronomeScanInputSchema,
  RaiseMetronomeChallengeInputSchema,
  WorkerOverlayChallengeInputSchema,
  MetronomeCorrectionInputSchema,
  MetronomeSafePauseInputSchema,
  MetronomeResolutionInputSchema,
} from "@maestro/contracts";
import { parse, requestOperator } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerOversightRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { metronome, encore } = deps;
  app.post("/v1/goals/:goalId/encore/reviews", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(EncoreReviewInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await encore.review(goalId, input, commandId);
    return reply.status(201).send(EncoreCouncilResultSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/metronome/scan", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(MetronomeScanInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.scan(goalId, input.projectId, commandId);
    return reply.status(200).send(MetronomeFindingListSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/metronome/challenges", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(RaiseMetronomeChallengeInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.raise(goalId, input, commandId);
    return reply.status(201).send(MetronomeChallengeSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/metronome/worker-overlays/challenges", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(WorkerOverlayChallengeInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.challengeWorkerOverlay(goalId, input, commandId);
    return reply.status(201).send(MetronomeChallengeSchema.parse(result));
  });

  app.post("/v1/metronome/challenges/:challengeId/correction", async (request, reply) => {
    const challengeId = parse(UuidSchema, (request.params as { challengeId?: unknown }).challengeId);
    const input = parse(MetronomeCorrectionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.requestCorrection(challengeId, input, commandId);
    return reply.status(200).send(MetronomeChallengeSchema.parse(result));
  });

  app.post("/v1/goals/:goalId/metronome/challenges/:challengeId/safe-pause", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const challengeId = parse(UuidSchema, (request.params as { challengeId?: unknown }).challengeId);
    const input = parse(MetronomeSafePauseInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await metronome.requestSafePause(goalId, challengeId, input, commandId);
    return reply.status(200).send(MetronomeChallengeSchema.parse(result));
  });

  app.post("/v1/metronome/challenges/:challengeId/resolve", async (request, reply) => {
    const challengeId = parse(UuidSchema, (request.params as { challengeId?: unknown }).challengeId);
    const input = parse(MetronomeResolutionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const operatorId = requestOperator(request as { operator?: OperatorContext }).operatorId;
    const result = await metronome.resolve(challengeId, input, commandId, operatorId);
    return reply.status(200).send(MetronomeChallengeSchema.parse(result));
  });
}
