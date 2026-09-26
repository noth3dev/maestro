import { describe, expect, it, vi } from "vitest";
import { approveInboxItem, denyInboxItem, discussWithConcertmaster, loadPendingApprovalCount } from "./inbox-data.js";
import { loadGlobalInbox } from "./inbox-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const commandId = "44444444-4444-4444-8444-444444444444";
const item = { decisionId: "33333333-3333-4333-8333-333333333333", commandId, projectId, goalId, actorId: "operator-1", action: "deployment.release", target: "production", policyVersion: 1, budgetEffectCents: 0, classification: "critical" as const, reason: "critical_action", decidedAt: "2025-01-01T00:00:00.000Z" };

describe("Inbox durable actions", () => {
  it("derives the sidebar badge from the aggregated durable response", async () => {
    await expect(loadPendingApprovalCount({ listInbox: vi.fn(async () => ({ projectId, items: [item, { ...item, decisionId: "66666666-6666-4666-8666-666666666666" }] })) }, projectId)).resolves.toBe(2);
  });

  it("approves with the exact pending command identity and server-supplied expiry input", async () => {
    const approveAndRunCriticalAction = vi.fn(async () => ({ goalId, effect: "allow" as const, reason: "exact_approval", classification: "critical" as const }));
    await approveInboxItem({ approveAndRunCriticalAction }, item, "2099-01-01T01:00:00.000Z");
    expect(approveAndRunCriticalAction).toHaveBeenCalledWith(goalId, { projectId, action: item.action, target: item.target, policyVersion: 1, budgetEffectCents: 0, expiresAt: "2099-01-01T01:00:00.000Z" }, commandId);
  });

  it("rejects expired approval input before contacting the server", async () => {
    const approveAndRunCriticalAction = vi.fn();
    await expect(approveInboxItem({ approveAndRunCriticalAction }, item, "2020-01-01T01:00:00.000Z", commandId)).rejects.toThrow("future");
    expect(approveAndRunCriticalAction).not.toHaveBeenCalled();
  });

  it("rejects a command identity that does not match the pending approval", async () => {
    const approveAndRunCriticalAction = vi.fn();
    await expect(approveInboxItem({ approveAndRunCriticalAction }, item, "2099-01-01T01:00:00.000Z", "55555555-5555-4555-8555-555555555555")).rejects.toThrow("command ID");
    expect(approveAndRunCriticalAction).not.toHaveBeenCalled();
  });

  it("denies through the exact pending command identity", async () => {
    const denyCriticalAction = vi.fn(async () => undefined);
    await denyInboxItem({ denyCriticalAction }, item);
    expect(denyCriticalAction).toHaveBeenCalledWith(goalId, { projectId, action: item.action, target: item.target, policyVersion: 1, budgetEffectCents: 0 }, commandId);
  });

  it("uses the selected live model for a new Concertmaster discussion", async () => {
    const conversationId = "66666666-6666-4666-8666-666666666666";
    const api = {
      listModels: vi.fn(async () => [
        { identity: { provider: "openai-codex", id: "gpt-a" }, capabilities: [], authModes: ["managed-subscription" as const], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy" as const, trainsOnCustomerData: false, regions: [] } },
        { identity: { provider: "openai-codex", id: "gpt-b" }, capabilities: [], authModes: ["managed-subscription" as const], reasoningEfforts: { supported: ["low", "high"], default: "high" }, dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy" as const, trainsOnCustomerData: false, regions: [] } },
      ]),
      createConversation: vi.fn(async () => ({ conversationId, projectId, goalId, model: "openai-codex/gpt-b", status: "active" as const, version: 1 })),
      sendConversationTurn: vi.fn(async () => ({ conversation: { conversationId, projectId, goalId, model: "openai-codex/gpt-b", status: "active" as const, version: 1 }, turn: { turnId: "77777777-7777-4777-8777-777777777777", conversationId, role: "assistant" as const, content: "selected", status: "completed" as const, cursor: "1", createdAt: "2025-01-01T00:00:00.000Z" } })),
    };
    await discussWithConcertmaster(api, { projectId, goalId, text: "Use the selected model", modelRef: "openai-codex/gpt-b", reasoningEffort: "low" });
    expect(api.createConversation).toHaveBeenCalledWith({ projectId, goalId, model: "openai-codex/gpt-b", reasoningEffort: "low" }, { idempotencyKey: expect.any(String) });
  });

  it("returns the real scoped Concertmaster response and can resume the same conversation", async () => {
    const conversationId = "66666666-6666-4666-8666-666666666666";
    const sendConversationTurn = vi.fn(async () => ({ conversation: { conversationId, projectId, goalId, model: "openai-codex/gpt-5.6-luna", status: "active" as const, version: 1 }, turn: { turnId: "77777777-7777-4777-8777-777777777777", conversationId, role: "assistant" as const, content: "The action needs approval because it changes production.", status: "completed" as const, cursor: "1", createdAt: "2025-01-01T00:00:00.000Z" } }));
    const api = {
      listModels: vi.fn(async () => [{ identity: { provider: "openai-codex", id: "gpt-5.6-luna" }, capabilities: [], authModes: ["managed-subscription" as const], dataPolicy: { allowedDataClasses: ["public", "workspace"], retention: "provider-policy" as const, trainsOnCustomerData: false, regions: [] } }]),
      createConversation: vi.fn(async () => ({ conversationId, projectId, goalId, model: "openai-codex/gpt-5.6-luna", status: "active" as const, version: 1 })),
      sendConversationTurn,
    };
    const first = await discussWithConcertmaster(api, { projectId, goalId, text: "Why is this approval needed?" });
    expect(first.turn.content).toContain("changes production");
    expect(api.createConversation).toHaveBeenCalledWith({ projectId, goalId, model: "openai-codex/gpt-5.6-luna" }, { idempotencyKey: expect.any(String) });
    expect(sendConversationTurn).toHaveBeenCalledWith(conversationId, { projectId, text: "Why is this approval needed?" }, { idempotencyKey: expect.any(String) });
    await discussWithConcertmaster(api, { projectId, goalId, conversationId, text: "What is the safer alternative?" });
    expect(api.createConversation).toHaveBeenCalledOnce();
    expect(sendConversationTurn).toHaveBeenLastCalledWith(conversationId, { projectId, text: "What is the safer alternative?" }, { idempotencyKey: expect.any(String) });
  });
});

describe("global inbox", () => {
  it("merges pending approvals from every project", async () => {
    const item = (projectId: string) => ({ projectId }) as never;
    const api = { listInbox: async (projectId: string) => ({ projectId, items: projectId === "b" ? [item("b"), item("b")] : [item("a")] }) };
    const inbox = await loadGlobalInbox(api as never, ["a", "b"]);
    expect(inbox.items).toHaveLength(3);
    await expect(loadGlobalInbox(api as never, [])).rejects.toThrow("No project");
  });
});
