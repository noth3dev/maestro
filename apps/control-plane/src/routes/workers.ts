import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "../server.js";
import {
  CertificationSchema,
  DepartmentAcceptanceSchema,
  AcceptWorkerInputSchema,
  CertifyWorkerInputSchema,
  UuidSchema,
  GoalQuerySchema,
  WorkerSchema,
  QueuedWorkerAdmissionSchema,
  WorkerObservationSchema,
  SpawnWorkerInputSchema,
  WorkerActionInputSchema,
  WorkerMessageInputSchema,
} from "@maestro/contracts";
import { parse, requestOperator, parseCertificationKind, parseDepartmentId } from "../server-input.js";
import type { OperatorContext } from "@maestro/persistence";

export function registerWorkerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { workers, certifications } = deps;
  app.post("/v1/councils/:councilId/departments/:departmentId/workers", async (request, reply) => {
    const params = request.params as { councilId?: unknown; departmentId?: unknown };
    const councilId = parse(UuidSchema, params.councilId);
    const departmentId = parseDepartmentId(params.departmentId);
    const input = parse(SpawnWorkerInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const worker = await workers.spawn(
      councilId,
      departmentId,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    if ("kind" in worker && worker.kind === "queued") return reply.status(202).send(QueuedWorkerAdmissionSchema.parse(worker));
    return reply.status(201).send(WorkerSchema.parse(worker));
  });

  app.post("/v1/workers/:workerId/observe", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(WorkerActionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const worker = await workers.observe(workerId, input.projectId, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(WorkerObservationSchema.parse(worker));
  });

  app.post("/v1/workers/:workerId/messages", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(WorkerMessageInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const worker = await workers.sendMessage(workerId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(WorkerSchema.parse(worker));
  });

  app.post("/v1/workers/:workerId/cancel", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(WorkerActionInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const worker = await workers.cancel(workerId, input.projectId, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(200).send(WorkerSchema.parse(worker));
  });

  app.post("/v1/workers/:workerId/accept", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(AcceptWorkerInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await certifications.accept(workerId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(DepartmentAcceptanceSchema.parse(result));
  });

  app.post("/v1/workers/:workerId/certifications/quality", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const input = parse(CertifyWorkerInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await certifications.certify(workerId, input, commandId, requestOperator(request as { operator?: OperatorContext }));
    return reply.status(201).send(CertificationSchema.parse({ ...result, kind: "quality" }));
  });

  app.post("/v1/workers/:workerId/certifications/:kind", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const kind = parseCertificationKind((request.params as { kind?: unknown }).kind);
    const input = parse(CertifyWorkerInputSchema, request.body);
    const commandId = parse(UuidSchema, request.headers["idempotency-key"]);
    const result = await certifications.certifyConditional(
      workerId,
      kind,
      input,
      commandId,
      requestOperator(request as { operator?: OperatorContext }),
    );
    return reply.status(201).send(CertificationSchema.parse(result));
  });

  app.get("/v1/workers/:workerId", async (request, reply) => {
    const workerId = parse(UuidSchema, (request.params as { workerId?: unknown }).workerId);
    const query = parse(GoalQuerySchema, request.query);
    const worker = await workers.get(workerId, query.projectId);
    return reply.status(200).send(WorkerSchema.parse(worker));
  });
}
