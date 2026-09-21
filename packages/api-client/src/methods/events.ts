import { EventQuerySchema, GoalEventPageSchema } from "@maestro/contracts";
import { readEventStream } from "../transport.js";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createEventsMethods(ctx: MethodContext): Pick<ApiClient, "listEvents" | "streamEvents"> {
  const { request, headers, fetch, base } = ctx;
  return {
    listEvents(query) {
      const parsed = EventQuerySchema.parse(query);
      return request(
        `v1/events?${new URLSearchParams({ projectId: parsed.projectId, after: parsed.after })}`,
        { headers },
        GoalEventPageSchema,
      );
    },
    streamEvents(query, options) {
      return readEventStream(fetch, base, headers, query, options?.signal, options?.onConnected);
    },
  };
}
