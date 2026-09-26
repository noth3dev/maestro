import type { ApiClient, ChannelMessage, ChannelRead, ChannelSelector } from "@maestro/api-client";
import { newCommandId } from "./command-id.js";

export async function loadChannel(api: Pick<ApiClient, "getChannel">, goalId: string, selector: ChannelSelector, projectId: string): Promise<ChannelRead> {
  return api.getChannel(goalId, selector, { projectId });
}

export async function postChannelMessage(
  api: Pick<ApiClient, "postChannelMessage">,
  goalId: string,
  selector: ChannelSelector,
  projectId: string,
  content: string,
  commandId: string,
  replyToMessageId?: string,
): Promise<ChannelMessage> {
  return api.postChannelMessage(goalId, selector, { projectId, content, ...(replyToMessageId === undefined ? {} : { replyToMessageId }) }, commandId);
}

/** Readable author names: Heads by department, the Overture lead as the meeting chair. */
export function channelAuthorName(author: ChannelMessage["author"]): string {
  if (author.kind === "operator") return "You";
  if (author.kind === "head") {
    const department = author.id.replace(/^head[-:]/, "");
    return `${department.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")} Head`;
  }
  if (author.id === "conversation-lead") return "Overture lead (chair)";
  return author.id;
}


export interface ChannelMessageAttempt {
  readonly content: string;
  readonly commandId: string;
}

/**
 * Channel POSTs accept an idempotency key. Reuse it only for a retry of the
 * same normalized draft; editing the draft always starts a new command.
 */
export function createChannelMessageAttempt(content: string, pending?: ChannelMessageAttempt): ChannelMessageAttempt {
  const normalized = content.trim();
  if (pending?.content === normalized) return pending;
  return { content: normalized, commandId: newCommandId() };
}
