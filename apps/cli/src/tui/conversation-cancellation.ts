import type { ApiClient } from "@maestro/api-client";

export interface ConversationCancellationOptions {
  controller: AbortController | undefined;
  client: Pick<ApiClient, "cancelConversation"> | undefined;
  projectId: string | undefined;
  conversationId: string | undefined;
  onWarning: (message: string) => void;
  onError: (message: string) => void;
}

export function cancelConversationTurn(options: ConversationCancellationOptions): boolean {
  if (options.controller === undefined) return false;
  options.controller.abort();
  options.onWarning("Cancelling the active conversation turn…");
  if (options.client !== undefined && options.projectId !== undefined && options.conversationId !== undefined) {
    void options.client
      .cancelConversation(options.conversationId, { projectId: options.projectId })
      .then((cancelled) => options.onWarning(`Conversation ${cancelled.conversationId}: ${cancelled.status}`))
      .catch((error) =>
        options.onError(`Conversation cancellation unavailable: ${error instanceof Error ? error.message : "unknown error"}`),
      );
  }
  return true;
}
