import {
  SpawnWorkerInputSchema,
  WorkerSchema,
  WorkerObservationSchema,
  WorkerActionInputSchema,
  WorkerMessageInputSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createWorkersMethods(
  ctx: MethodContext,
): Pick<ApiClient, "spawnWorker" | "getWorker" | "observeWorker" | "sendWorkerMessage" | "cancelWorker"> {
  const { request, headers } = ctx;
  return {
    spawnWorker(councilId, departmentId, input, commandId) {
      if (!/^[A-Za-z0-9:_-]+$/.test(departmentId)) throw new Error("Invalid department ID");
      return request(
        `v1/councils/${encodeURIComponent(UuidSchema.parse(councilId))}/departments/${encodeURIComponent(departmentId)}/workers`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(SpawnWorkerInputSchema.parse(input)),
        },
        WorkerSchema,
      );
    },
    getWorker(workerId, projectId) {
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}?${new URLSearchParams({ projectId: UuidSchema.parse(projectId) })}`,
        { headers },
        WorkerSchema,
      );
    },
    observeWorker(workerId, input, commandId) {
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/observe`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(WorkerActionInputSchema.parse(input)),
        },
        WorkerObservationSchema,
      );
    },
    sendWorkerMessage(workerId, input, commandId) {
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/messages`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(WorkerMessageInputSchema.parse(input)),
        },
        WorkerSchema,
      );
    },
    cancelWorker(workerId, input, commandId) {
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/cancel`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(WorkerActionInputSchema.parse(input)),
        },
        WorkerSchema,
      );
    },
  };
}
