import type { ApiClient, InboxRead, CriticalActionApprovalInput } from "@maestro/api-client";

export function loadInbox(api: Pick<ApiClient, "listInbox">, projectId: string): Promise<InboxRead> {
  return api.listInbox(projectId);
}

export function approveInboxItem(
  api: Pick<ApiClient, "approveAndRunCriticalAction">,
  item: InboxRead["items"][number],
  expiresAt: string,
  commandId: string,
): Promise<Awaited<ReturnType<ApiClient["approveAndRunCriticalAction"]>>> {
  const input: CriticalActionApprovalInput = {
    projectId: item.projectId,
    action: item.action,
    target: item.target,
    policyVersion: item.policyVersion,
    budgetEffectCents: item.budgetEffectCents,
    expiresAt,
  };
  return api.approveAndRunCriticalAction(item.goalId, input, commandId);
}

export async function discussWithConcertmaster(
  api: Pick<ApiClient, "listModels" | "createConversation" | "sendConversationTurn">,
  input: { projectId: string; goalId: string; text: string },
): Promise<void> {
  const models = await api.listModels();
  const selected = models[0];
  if (selected === undefined) throw new Error("No Concertmaster model is available");
  const model = `${selected.identity.provider}/${selected.identity.id}`;
  const conversation = await api.createConversation({ projectId: input.projectId, goalId: input.goalId, model });
  await api.sendConversationTurn(conversation.conversationId, { projectId: input.projectId, text: input.text });
}

export async function loadPendingApprovalCount(api: Pick<ApiClient, "listInbox">, projectId: string): Promise<number> {
  return (await api.listInbox(projectId)).items.length;
}

export function denyInboxItem(
  api: Pick<ApiClient, "denyCriticalAction">,
  item: InboxRead["items"][number],
  commandId: string,
): Promise<Awaited<ReturnType<ApiClient["denyCriticalAction"]>>> {
  return api.denyCriticalAction(item.goalId, {
    projectId: item.projectId, action: item.action, target: item.target,
    policyVersion: item.policyVersion, budgetEffectCents: item.budgetEffectCents,
  }, commandId);
}
