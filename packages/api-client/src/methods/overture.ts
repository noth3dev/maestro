import {
  AppendOvertureOperatorMessageBodySchema,
  CreateOvertureRunBodySchema,
  OvertureEventQuerySchema,
  OvertureEventSchema,
  OvertureMessageSchema,
  OvertureRunQuerySchema,
  OvertureRunSchema,
  UuidSchema,
} from "@maestro/contracts";
import { cryptoRandomUuid } from "../transport.js";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createOvertureMethods(
  ctx: MethodContext,
): Pick<ApiClient, "createOvertureRun" | "getOvertureRun" | "sendOvertureOperatorMessage" | "listOvertureEvents"> {
  const { request, headers } = ctx;
  return {
    createOvertureRun(input, options) {
      return request(
        "v1/overture/runs",
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": UuidSchema.parse(options?.idempotencyKey ?? cryptoRandomUuid()),
          },
          body: JSON.stringify(CreateOvertureRunBodySchema.parse(input)),
        },
        OvertureRunSchema,
      );
    },
    getOvertureRun(runId, query) {
      const parsedRunId = UuidSchema.parse(runId);
      const parsedQuery = OvertureRunQuerySchema.parse(query);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}?${new URLSearchParams({ projectId: parsedQuery.projectId, conversationId: parsedQuery.conversationId })}`,
        { headers },
        OvertureRunSchema,
      );
    },
    sendOvertureOperatorMessage(runId, input, options) {
      const parsedRunId = UuidSchema.parse(runId);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/messages`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": UuidSchema.parse(options?.idempotencyKey ?? cryptoRandomUuid()),
          },
          body: JSON.stringify(AppendOvertureOperatorMessageBodySchema.parse(input)),
        },
        OvertureMessageSchema,
      );
    },
    listOvertureEvents(runId, query) {
      const parsedRunId = UuidSchema.parse(runId);
      const parsedQuery = OvertureEventQuerySchema.parse(query);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/events?${new URLSearchParams({ projectId: parsedQuery.projectId, conversationId: parsedQuery.conversationId, afterCursor: parsedQuery.afterCursor })}`,
        { headers },
        OvertureEventSchema.array(),
      );
    },
  };
}
