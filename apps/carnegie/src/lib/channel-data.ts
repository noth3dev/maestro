import type { ApiClient, ChannelMessage, ChannelRead, ChannelSelector } from "@maestro/api-client";

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
