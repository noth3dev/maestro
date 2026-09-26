import {
  AppendOvertureOperatorMessageBodySchema,
  CreateOvertureRunBodySchema,
  ReviseOverturePlanBodySchema,
  OvertureEventQuerySchema,
  OvertureArtifactSchema,
  OvertureEventSchema,
  OvertureMessageSchema,
  OverturePlanManifestSchema,
  OverturePlanDocumentSchema,
  OvertureClarificationSchema,
  OpenOvertureClarificationBodySchema,
  AnswerOvertureClarificationBodySchema,
  CreateOvertureTaskContractBodySchema,
  CreateOvertureWorkspaceTaskContractBodySchema,
  TaskContractSchema,
  OvertureRunQuerySchema,
  OvertureRunSchema,
  UuidSchema,
} from "@maestro/contracts";
import { cryptoRandomUuid, readOvertureEventStream } from "../transport.js";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createOvertureMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  | "createOvertureRun"
  | "getOvertureRun"
  | "listOvertureRuns"
  | "sendOvertureOperatorMessage"
  | "listOvertureMessages"
  | "listOvertureArtifacts"
  | "getOverturePlanManifest"
  | "reviseOverturePlan"
  | "openOvertureClarification"
  | "answerOvertureClarification"
  | "createOvertureTaskContract"
  | "createOvertureWorkspaceTaskContract"
  | "listOvertureEvents"
  | "streamOvertureEvents"
> {
  const { request, headers, fetch, base } = ctx;
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
    listOvertureRuns(query) {
      const parsedQuery = OvertureRunQuerySchema.parse(query);
      return request(
        `v1/overture/runs?${new URLSearchParams({ projectId: parsedQuery.projectId, conversationId: parsedQuery.conversationId })}`,
        { headers },
        OvertureRunSchema.array(),
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
    listOvertureArtifacts(runId, query) {
      const parsedRunId = UuidSchema.parse(runId);
      const parsedQuery = OvertureRunQuerySchema.parse(query);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/artifacts?${new URLSearchParams({ projectId: parsedQuery.projectId, conversationId: parsedQuery.conversationId })}`,
        { headers },
        OvertureArtifactSchema.array(),
      );
    },
    getOverturePlanManifest(runId, query) {
      const parsedRunId = UuidSchema.parse(runId);
      const parsedQuery = OvertureRunQuerySchema.parse(query);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/plan-manifest?${new URLSearchParams({ projectId: parsedQuery.projectId, conversationId: parsedQuery.conversationId })}`,
        { headers },
        OverturePlanManifestSchema,
      );
    },
    reviseOverturePlan(runId, documentId, input, options) {
      const parsedRunId = UuidSchema.parse(runId);
      const parsedDocumentId = UuidSchema.parse(documentId);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/plan-documents/${encodeURIComponent(parsedDocumentId)}`,
        {
          method: "PUT",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": UuidSchema.parse(options?.idempotencyKey ?? cryptoRandomUuid()),
          },
          body: JSON.stringify(ReviseOverturePlanBodySchema.parse(input)),
        },
        OverturePlanDocumentSchema,
      );
    },
    openOvertureClarification(runId, input, options) {
      const parsedRunId = UuidSchema.parse(runId);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/clarifications`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": UuidSchema.parse(options?.idempotencyKey ?? cryptoRandomUuid()),
          },
          body: JSON.stringify(OpenOvertureClarificationBodySchema.parse(input)),
        },
        OvertureClarificationSchema,
      );
    },
    answerOvertureClarification(runId, clarificationId, input, options) {
      const parsedRunId = UuidSchema.parse(runId);
      const parsedClarificationId = UuidSchema.parse(clarificationId);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/clarifications/${encodeURIComponent(parsedClarificationId)}/answer`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": UuidSchema.parse(options?.idempotencyKey ?? cryptoRandomUuid()),
          },
          body: JSON.stringify(AnswerOvertureClarificationBodySchema.parse(input)),
        },
        OvertureClarificationSchema,
      );
    },
    createOvertureWorkspaceTaskContract(runId, input, options) {
      const parsedRunId = UuidSchema.parse(runId);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/workspace-task-contract`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": UuidSchema.parse(options?.idempotencyKey ?? cryptoRandomUuid()),
          },
          body: JSON.stringify(CreateOvertureWorkspaceTaskContractBodySchema.parse(input)),
        },
        TaskContractSchema,
      );
    },
    createOvertureTaskContract(runId, input, options) {
      const parsedRunId = UuidSchema.parse(runId);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/task-contract`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": UuidSchema.parse(options?.idempotencyKey ?? cryptoRandomUuid()),
          },
          body: JSON.stringify(CreateOvertureTaskContractBodySchema.parse(input)),
        },
        TaskContractSchema,
      );
    },
    listOvertureMessages(runId, query) {
      const parsedRunId = UuidSchema.parse(runId);
      const parsedQuery = OvertureEventQuerySchema.parse(query);
      return request(
        `v1/overture/runs/${encodeURIComponent(parsedRunId)}/messages?${new URLSearchParams({ projectId: parsedQuery.projectId, conversationId: parsedQuery.conversationId, afterCursor: parsedQuery.afterCursor })}`,
        { headers },
        OvertureMessageSchema.array(),
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
    streamOvertureEvents(runId, query, options) {
      return readOvertureEventStream(fetch, base, headers, UuidSchema.parse(runId), query, options?.signal);
    },
  };
}
