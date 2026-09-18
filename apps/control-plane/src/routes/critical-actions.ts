import type { FastifyInstance } from "fastify";
import type { CriticalActionRouteDeps } from "./deps.js";
import { UuidSchema, CriticalActionInputSchema, CriticalActionApprovalInputSchema, CriticalActionResultSchema } from "@maestro/contracts";
import { parse, requestOperator, CriticalActionDeniedError, CriticalActionRequiresApprovalError } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerCriticalActionRoutes(app: FastifyInstance, deps: CriticalActionRouteDeps): void {
  const { criticalActions } = deps;
  app.post("/v1/goals/:goalId/critical-actions", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(CriticalActionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const decision = await criticalActions.performCriticalAction(
      goalId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    if (decision.effect === "deny") throw new CriticalActionDeniedError(decision.reason);
    if (decision.effect === "require_approval") throw new CriticalActionRequiresApprovalError(decision.reason);
    return reply.status(200).send(
      CriticalActionResultSchema.parse({
        goalId,
        effect: decision.effect,
        reason: decision.reason,
        classification: decision.classification,
        ...(decision.recordId === undefined ? {} : { recordId: decision.recordId }),
      }),
    );
  });

  app.post("/v1/goals/:goalId/critical-actions/approve-and-run", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(CriticalActionApprovalInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const decision = await criticalActions.approveAndPerformCriticalAction(
      goalId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    if (decision.effect === "deny") throw new CriticalActionDeniedError(decision.reason);
    if (decision.effect === "require_approval") throw new CriticalActionRequiresApprovalError(decision.reason);
    return reply.status(200).send(
      CriticalActionResultSchema.parse({
        goalId,
        effect: decision.effect,
        reason: decision.reason,
        classification: decision.classification,
        ...(decision.recordId === undefined ? {} : { recordId: decision.recordId }),
      }),
    );
  });

  app.post("/v1/goals/:goalId/critical-actions/deny", async (request, reply) => {
    const goalId = parse(UuidSchema, (request.params as { goalId?: unknown }).goalId);
    const input = parse(CriticalActionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    await criticalActions.denyCriticalAction(goalId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(204).send();
  });
}
