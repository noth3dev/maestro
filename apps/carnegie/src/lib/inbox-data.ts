import type { ApiClient, InboxRead, CriticalActionApprovalInput } from "@maestro/api-client";
import type { ConversationTurnResult } from "@maestro/contracts";
import { newCommandId } from "./command-id.js";

export function loadInbox(api: Pick<ApiClient, "listInbox">, projectId: string): Promise<InboxRead> {
  return api.listInbox(projectId);
}

function assertFutureExpiry(expiresAt: string, now = Date.now): string {
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp) || timestamp <= now()) throw new Error("Approval expiry must be in the future");
  return new Date(timestamp).toISOString();
}

function assertApprovalCommand(item: InboxRead["items"][number], commandId: string): void {
  if (commandId !== item.commandId) throw new Error("Approval command ID does not match the pending decision");
}

export async function approveInboxItem(
  api: Pick<ApiClient, "approveAndRunCriticalAction">,
  item: InboxRead["items"][number],
  expiresAt: string,
  commandId = item.commandId,
  now = Date.now,
): Promise<Awaited<ReturnType<ApiClient["approveAndRunCriticalAction"]>>> {
  assertApprovalCommand(item, commandId);
  const input: CriticalActionApprovalInput = {
    projectId: item.projectId,
    action: item.action,
    target: item.target,
    policyVersion: item.policyVersion,
    budgetEffectCents: item.budgetEffectCents,
    expiresAt: assertFutureExpiry(expiresAt, now),
  };
  return api.approveAndRunCriticalAction(item.goalId, input, commandId);
}

export async function denyInboxItem(
  api: Pick<ApiClient, "denyCriticalAction">,
  item: InboxRead["items"][number],
  commandId = item.commandId,
): Promise<Awaited<ReturnType<ApiClient["denyCriticalAction"]>>> {
  assertApprovalCommand(item, commandId);
  return api.denyCriticalAction(item.goalId, {
    projectId: item.projectId,
    action: item.action,
    target: item.target,
    policyVersion: item.policyVersion,
    budgetEffectCents: item.budgetEffectCents,
  }, commandId);
}

export type InboxDiscussionApi = Pick<ApiClient, "listModels" | "createConversation" | "sendConversationTurn">;

/**
 * Discusses the pending decision through the scoped Concertmaster conversation.
 * The server response is returned to the renderer; no local answer is fabricated.
 */
export async function discussWithConcertmaster(
  api: InboxDiscussionApi,
  input: { projectId: string; goalId: string; text: string; modelRef?: string; reasoningEffort?: string; conversationId?: string },
): Promise<ConversationTurnResult> {
  const text = input.text.trim();
  if (text === "") throw new Error("Discussion text cannot be empty");
  let conversationId = input.conversationId;
  if (conversationId === undefined) {
    const models = await api.listModels();
    const selected =
      input.modelRef === undefined
        ? models[0]
        : models.find((candidate) => `${candidate.identity.provider}/${candidate.identity.id}` === input.modelRef);
    if (selected === undefined) {
      throw new Error(input.modelRef === undefined ? "No Concertmaster model is available" : "Selected Concertmaster model is no longer available");
    }
    const model = `${selected.identity.provider}/${selected.identity.id}`;
    if (input.reasoningEffort !== undefined && !selected.reasoningEfforts?.supported.includes(input.reasoningEffort))
      throw new Error("Selected thinking strength is no longer available for this model");
    const conversation = await api.createConversation(
      { projectId: input.projectId, goalId: input.goalId, model, ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }) },
      { idempotencyKey: newCommandId() },
    );
    if (conversation.projectId !== input.projectId || conversation.goalId !== input.goalId) {
      throw new Error("Concertmaster conversation scope does not match the pending approval");
    }
    conversationId = conversation.conversationId;
  }
  const result = await api.sendConversationTurn(
    conversationId,
    { projectId: input.projectId, text },
    { idempotencyKey: newCommandId() },
  );
  if (result.conversation.projectId !== input.projectId || result.conversation.goalId !== input.goalId) {
    throw new Error("Concertmaster response scope does not match the pending approval");
  }
  return result;
}

export async function loadPendingApprovalCount(api: Pick<ApiClient, "listInbox">, projectId: string): Promise<number> {
  return (await api.listInbox(projectId)).items.length;
}
