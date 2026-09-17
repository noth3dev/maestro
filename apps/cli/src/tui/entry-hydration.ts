import type { ApiClient } from "@maestro/api-client";
import type { ConversationEvent, TaskContract } from "@maestro/contracts";
import { hydrateOrganizationState } from "./startup.js";
import type { TuiShellState } from "./components/shell.js";
import { applyConversationEvent, isTerminalConversationEvent, type ConversationTranscriptState } from "./conversation-transcript.js";
import { priorTaskContractDraft } from "./conversation-draft.js";

export async function hydrateOrganizationOnReconnect(
  state: Pick<TuiShellState, "organization">,
  client: Pick<ApiClient, "getOrganization">,
): Promise<void> {
  state.organization = { kind: "loading" };
  state.organization = await hydrateOrganizationState(client);
}

/** Prefer the explicitly configured model, falling back to the persisted session selection. */
export function resolveConfiguredModel(environmentModel: string | undefined, sessionModel: string | undefined): string | undefined {
  return environmentModel?.trim() || sessionModel;
}

export function handleConversationStreamEvent(options: {
  conversation: ConversationTranscriptState;
  event: ConversationEvent;
  dismissSplash: () => void;
  onCompactOutcome?: (conversation: ConversationTranscriptState) => void;
  render: () => void;
}): { conversation: ConversationTranscriptState; terminal: boolean } {
  const conversation = applyConversationEvent(options.conversation, options.event);
  options.dismissSplash();
  options.onCompactOutcome?.(conversation);
  options.render();
  return { conversation, terminal: isTerminalConversationEvent(conversation, options.event) };
}

export function applyHydratedConversation(
  hydrated: ConversationTranscriptState,
  goalId: string | null | undefined,
  callbacks: {
    setConversation: (conversation: ConversationTranscriptState) => void;
    setDraft: (draft: TaskContract) => void;
    showDraft: (content: string) => void;
  },
): void {
  callbacks.setConversation(hydrated);
  const priorDraft = priorTaskContractDraft(hydrated.messages, goalId);
  if (priorDraft !== undefined) {
    callbacks.setDraft(priorDraft);
    callbacks.showDraft(JSON.stringify(priorDraft));
  }
}
