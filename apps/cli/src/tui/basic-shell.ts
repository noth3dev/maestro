import type { ConversationTranscriptState } from "./conversation-transcript.js";

import { createTranscriptClearBoundary } from "./conversation-turn-boundary.js";

export { createTranscriptClearBoundary };

export type BasicShellCommandName = "clear" | "exit" | "quit" | "version" | "copy";

export interface BasicShellCommandContext {
  clearTranscript: () => void;
  stop: () => void;
  getLatestTranscriptText: () => string | undefined;
  copyToClipboard: (text: string) => Promise<void>;
  write: (text: string) => void;
  version: string;
}

/** Return the latest non-empty assistant or system transcript content in display order. */
export function latestCopyableTranscriptText(state: ConversationTranscriptState): string | undefined {
  const candidates: { text: string; occurredAt: string; order: number }[] = [];
  let order = 0;
  for (const item of state.manualMessages) {
    if ((item.message.role === "assistant" || item.message.role === "system") && item.message.content.trim() !== "") {
      candidates.push({ text: item.message.content, occurredAt: item.occurredAt, order: order++ });
    }
  }
  const assistantEvents = state.events.filter((event) => event.eventType === "turn_delta" || event.eventType === "turn_completed");
  const latestAssistantEvent = assistantEvents.at(-1);
  if (state.assistantText.trim() !== "") {
    candidates.push({ text: state.assistantText, occurredAt: latestAssistantEvent?.occurredAt ?? "", order: order++ });
  }
  for (const message of state.messages) {
    if (
      (message.role === "assistant" || message.role === "system") &&
      message.content.trim() !== "" &&
      !candidates.some((candidate) => candidate.text === message.content)
    ) {
      candidates.push({ text: message.content, occurredAt: "", order: order++ });
    }
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? 1 : -1;
    return left.order - right.order;
  });
  return candidates.at(-1)?.text;
}

/** Execute commands that only affect the local interactive shell. */
export async function executeBasicShellCommand(command: string, context: BasicShellCommandContext): Promise<boolean> {
  if (command === "clear") {
    context.clearTranscript();
    return true;
  }
  if (command === "exit" || command === "quit") {
    context.stop();
    return true;
  }
  if (command === "version") {
    context.write(context.version);
    return true;
  }
  if (command === "copy") {
    const text = context.getLatestTranscriptText()?.trim();
    if (text === undefined || text === "") {
      context.write("No transcript text to copy.");
      return true;
    }
    try {
      await context.copyToClipboard(text);
      context.write("Transcript copied to the clipboard.");
    } catch {
      context.write(`Clipboard unavailable. Copy this transcript line: ${text}`);
    }
    return true;
  }
  return false;
}
