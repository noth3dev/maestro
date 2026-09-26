import {
  GoalQuerySchema,
  ConversationSchema,
  ConversationListQuerySchema,
  ConversationSummarySchema,
  SessionWorkspaceFileQuerySchema,
  SessionWorkspaceFileSchema,
  SessionWorkspaceListingSchema,
  CreateConversationInputSchema,
  ConversationTurnInputSchema,
  ConversationTurnResultSchema,
  ConversationEventQuerySchema,
  ConversationEventSchema,
  UuidSchema,
} from "@maestro/contracts";
import { cryptoRandomUuid, readConversationEventStream, readConversationActivityStream } from "../transport.js";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createConversationsMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  | "createConversation"
  | "listConversations"
  | "listSessionWorkspaceFiles"
  | "readSessionWorkspaceFile"
  | "getConversation"
  | "sendConversationTurn"
  | "cancelConversation"
  | "listConversationEvents"
  | "streamConversationEvents"
  | "streamConversationActivity"
> {
  const { request, headers, fetch, base } = ctx;
  return {
    createConversation(input, options) {
      return request(
        "v1/conversations",
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": options?.idempotencyKey === undefined ? cryptoRandomUuid() : UuidSchema.parse(options.idempotencyKey),
          },
          body: JSON.stringify(CreateConversationInputSchema.parse(input)),
        },
        ConversationSchema,
      );
    },
    listConversations(query) {
      const parsed = ConversationListQuerySchema.parse(query);
      return request(
        `v1/conversations?${new URLSearchParams({ projectId: parsed.projectId, limit: String(parsed.limit) })}`,
        { headers },
        ConversationSummarySchema.array(),
      );
    },
    listSessionWorkspaceFiles(conversationId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}/workspace/files?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        SessionWorkspaceListingSchema,
      );
    },
    readSessionWorkspaceFile(conversationId, query) {
      const parsed = SessionWorkspaceFileQuerySchema.parse(query);
      return request(
        `v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}/workspace/file?${new URLSearchParams({ projectId: parsed.projectId, path: parsed.path })}`,
        { headers },
        SessionWorkspaceFileSchema,
      );
    },
    getConversation(conversationId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        ConversationSchema,
      );
    },
    sendConversationTurn(conversationId, input, options) {
      return request(
        `v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}/turns`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "idempotency-key": options?.idempotencyKey === undefined ? cryptoRandomUuid() : UuidSchema.parse(options.idempotencyKey),
          },
          body: JSON.stringify(ConversationTurnInputSchema.parse(input)),
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        },
        ConversationTurnResultSchema,
        // A model turn can legitimately take minutes.
        300_000,
      );
    },
    cancelConversation(conversationId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}/cancel`,
        { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(parsed) },
        ConversationSchema,
      );
    },
    listConversationEvents(conversationId, query) {
      const parsed = ConversationEventQuerySchema.parse(query);
      return request(
        `v1/conversations/${encodeURIComponent(UuidSchema.parse(conversationId))}/events?${new URLSearchParams({ projectId: parsed.projectId, after: parsed.after }).toString()}`,
        { headers },
        ConversationEventSchema.array(),
      );
    },
    streamConversationEvents(conversationId, query, options) {
      return readConversationEventStream(fetch, base, headers, UuidSchema.parse(conversationId), query, options?.signal);
    },
    streamConversationActivity(conversationId, query, options) {
      return readConversationActivityStream(
        fetch,
        base,
        headers,
        UuidSchema.parse(conversationId),
        query,
        options?.signal,
        options?.onConnected,
      );
    },
  };
}
