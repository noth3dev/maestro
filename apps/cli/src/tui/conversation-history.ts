import type { ApiClient } from "@maestro/api-client";
import type { ConversationEvent } from "@maestro/contracts";

import { applyConversationEvent, createConversationTranscript, type ConversationTranscriptState } from "./conversation-transcript.js";

export interface ConversationHistoryOptions {
  client: Pick<ApiClient, "listConversationEvents">;
  conversationId: string;
  projectId: string;
  isCurrent: () => boolean;
}

export async function loadConversationHistory(options: ConversationHistoryOptions): Promise<ConversationTranscriptState | undefined> {
  let hydrated = createConversationTranscript();
  let cursor = "0";
  for (let page = 0; page < 64; page += 1) {
    const events = await options.client.listConversationEvents(options.conversationId, { projectId: options.projectId, after: cursor });
    if (!options.isCurrent()) return undefined;
    for (const event of events) hydrated = applyConversationEvent(hydrated, event as ConversationEvent);
    const nextCursor = events.at(-1)?.cursor;
    if (nextCursor === undefined || events.length < 256) break;
    cursor = nextCursor;
  }
  if (!options.isCurrent()) return undefined;
  return hydrated;
}
