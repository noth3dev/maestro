import type { TaskContract } from "@maestro/contracts";
import { extractTaskContractDraft } from "./goal-less-intake.js";
import type { ConversationTranscriptMessage } from "./conversation-transcript.js";

export function taskContractDraftForConversation(content: string, goalId: string | null | undefined): TaskContract | undefined {
  if (goalId !== null && goalId !== undefined) return undefined;
  return extractTaskContractDraft(content);
}

export function priorTaskContractDraft(
  messages: readonly Pick<ConversationTranscriptMessage, "role" | "content">[],
  goalId: string | null | undefined,
): TaskContract | undefined {
  return [...messages]
    .reverse()
    .filter((message) => message.role === "assistant")
    .map((message) => taskContractDraftForConversation(message.content, goalId))
    .find((draft): draft is TaskContract => draft !== undefined);
}
