import { describe, expect, it, vi } from "vitest";
import { approveInboxItem, createInboxApprovalExpiry, denyInboxItem, discussWithConcertmaster, loadPendingApprovalCount } from "./inbox-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const item = { decisionId: "33333333-3333-4333-8333-333333333333", commandId: "44444444-4444-4444-8444-444444444444", projectId, goalId, actorId: "operator-1", action: "deployment.release", target: "production", policyVersion: 1, budgetEffectCents: 0, classification: "critical" as const, reason: "critical_action", decidedAt: "2025-01-01T00:00:00.000Z" };

describe("Inbox durable actions", () => {
  it("derives the sidebar badge from the aggregated durable response", async () => {
    await expect(loadPendingApprovalCount({ listInbox: vi.fn(async () => ({ projectId, items: [item, { ...item, decisionId: "66666666-6666-4666-8666-666666666666" }] })) }, projectId)).resolves.toBe(2);
  });

  it("keeps approval expiry stable by command identity across decision changes and renderer reload", () => {
    let now = 1_000;
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const expiry = createInboxApprovalExpiry(() => now, storage);
    const first = expiry(item);
    now = 2_000;
    const changedDecision = { ...item, decisionId: "66666666-6666-4666-8666-666666666666" };
    expect(expiry(changedDecision)).toBe(first);
    const reloadedExpiry = createInboxApprovalExpiry(() => now, storage);
    expect(reloadedExpiry(changedDecision)).toBe(first);
  });

  it("approves through the existing Goal-scoped approval route", async () => {
    const approveAndRunCriticalAction = vi.fn(async () => ({ goalId, effect: "allow" as const, reason: "exact_approval", classification: "critical" as const }));
    await approveInboxItem({ approveAndRunCriticalAction }, item, "2025-01-01T01:00:00.000Z", "55555555-5555-4555-8555-555555555555");
    expect(approveAndRunCriticalAction).toHaveBeenCalledWith(goalId, { projectId, action: item.action, target: item.target, policyVersion: 1, budgetEffectCents: 0, expiresAt: "2025-01-01T01:00:00.000Z" }, "55555555-5555-4555-8555-555555555555");
  });

  it("denies through the existing Goal-scoped critical-action route", async () => {
    const denyCriticalAction = vi.fn(async () => ({ goalId, effect: "deny" as const, reason: "operator_rejected", classification: "critical" as const }));
    await denyInboxItem({ denyCriticalAction }, item, "55555555-5555-4555-8555-555555555555");
    expect(denyCriticalAction).toHaveBeenCalledWith(goalId, { projectId, action: item.action, target: item.target, policyVersion: 1, budgetEffectCents: 0 }, "55555555-5555-4555-8555-555555555555");
  });

  it("uses sendConversationTurn for Discuss with Concertmaster, never the channel system", async () => {
    const sendConversationTurn = vi.fn(async () => ({ conversation: { conversationId: "66666666-6666-4666-8666-666666666666" }, turn: {} }));
    const postChannelMessage = vi.fn();
    const api = {
      listModels: vi.fn(async () => [{ identity: { provider: "openai-codex", id: "gpt-5.6-luna" }, capabilities: [], authModes: ["managed-subscription"], dataPolicy: { allowedDataClasses: ["public", "workspace"], retention: "provider-policy", trainsOnCustomerData: false, regions: [] } }]),
      createConversation: vi.fn(async () => ({ conversationId: "66666666-6666-4666-8666-666666666666", projectId, goalId, model: "openai-codex/gpt-5.6-luna", status: "active" as const, version: 1 })),
      sendConversationTurn,
      postChannelMessage,
    };
    await discussWithConcertmaster(api, { projectId, goalId, text: "Why is this approval needed?" });
    expect(sendConversationTurn).toHaveBeenCalledOnce();
    expect(postChannelMessage).not.toHaveBeenCalled();
  });
});
