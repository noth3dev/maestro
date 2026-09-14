import type { ApiClient, InboxRead, CriticalActionApprovalInput } from "@maestro/api-client";

export function loadInbox(api: Pick<ApiClient, "listInbox">, projectId: string): Promise<InboxRead> {
  return api.listInbox(projectId);
}

interface ApprovalExpiryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserApprovalExpiryStorage(): ApprovalExpiryStorage | undefined {
  try {
    return (globalThis as typeof globalThis & { localStorage?: ApprovalExpiryStorage }).localStorage;
  } catch {
    return undefined;
  }
}

export function createInboxApprovalExpiry(
  now: () => number = Date.now,
  storage: ApprovalExpiryStorage | undefined = browserApprovalExpiryStorage(),
): (item: Pick<InboxRead["items"][number], "commandId">) => string {
  const expiries = new Map<string, string>();
  return (item) => {
    const key = `maestro:inbox-approval-expiry:${item.commandId}`;
    const existing = expiries.get(key) ?? storage?.getItem(key) ?? undefined;
    if (existing !== undefined) {
      expiries.set(key, existing);
      return existing;
    }
    const value = new Date(now() + 60 * 60 * 1000).toISOString();
    expiries.set(key, value);
    try { storage?.setItem(key, value); } catch { /* Storage may be unavailable or full. */ }
    return value;
  };
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
