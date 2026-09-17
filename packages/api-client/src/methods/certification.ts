import {
  AcceptWorkerInputSchema,
  DepartmentAcceptanceSchema,
  CertifyWorkerInputSchema,
  CertificationSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createCertificationMethods(
  ctx: MethodContext,
): Pick<ApiClient, "acceptWorker" | "certifyWorker" | "certifyConditionalWorker"> {
  const { request, headers } = ctx;
  return {
    acceptWorker(workerId, input, commandId) {
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/accept`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(AcceptWorkerInputSchema.parse(input)),
        },
        DepartmentAcceptanceSchema,
      );
    },
    certifyWorker(workerId, input, commandId) {
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/certifications/quality`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CertifyWorkerInputSchema.parse(input)),
        },
        CertificationSchema,
      );
    },
    certifyConditionalWorker(workerId, kind, input, commandId) {
      if (kind !== "security" && kind !== "safety_compliance") throw new Error("Invalid conditional certification kind");
      return request(
        `v1/workers/${encodeURIComponent(UuidSchema.parse(workerId))}/certifications/${kind}`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CertifyWorkerInputSchema.parse(input)),
        },
        CertificationSchema,
      );
    },
  };
}
