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
): Promise<ChannelMessage> {
  return api.postChannelMessage(goalId, selector, { projectId, content }, commandId);
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
