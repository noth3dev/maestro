import { describe, expect, it, vi } from "vitest";
import { loadConversation, type GoalLessIntakeApi } from "./conversation-data.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const turnId = "33333333-3333-4333-8333-333333333333";

function api(): GoalLessIntakeApi {
  return {
    listModels: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn().mockResolvedValue({ conversationId, projectId, goalId: null, model: "openai/gpt-5", status: "succeeded", version: 2 }),
    listConversationEvents: vi.fn().mockResolvedValue([
      { cursor: "1", eventId: "44444444-4444-4444-8444-444444444444", conversationId, projectId, eventType: "turn_started", payload: { turnId, text: "Ship the pricing copy" }, occurredAt: "2026-09-21T00:00:00.000Z" },
      { cursor: "2", eventId: "55555555-5555-4555-8555-555555555555", conversationId, projectId, eventType: "turn_delta", payload: { turnId, text: "I will draft" }, occurredAt: "2026-09-21T00:00:01.000Z" },
      { cursor: "3", eventId: "66666666-6666-4666-8666-666666666666", conversationId, projectId, eventType: "turn_delta", payload: { turnId, text: " a safe contract." }, occurredAt: "2026-09-21T00:00:02.000Z" },
      { cursor: "4", eventId: "77777777-7777-4777-8777-777777777777", conversationId, projectId, eventType: "turn_completed", payload: { turnId, status: "succeeded", content: "I will draft a safe contract." }, occurredAt: "2026-09-21T00:00:03.000Z" },
    ]),
    sendConversationTurn: vi.fn(),
    cancelConversation: vi.fn(),
  };
}

describe("conversation durable read model", () => {
  it("reloads a real conversation from ordered durable events without duplicating deltas", async () => {
    const client = api();
    await expect(loadConversation(client, { conversationId, projectId })).resolves.toEqual([
      { id: "44444444-4444-4444-8444-444444444444", role: "operator", content: "Ship the pricing copy", createdAt: "2026-09-21T00:00:00.000Z" },
      { id: turnId, role: "concertmaster", content: "I will draft a safe contract.", createdAt: "2026-09-21T00:00:03.000Z" },
    ]);
    expect(client.getConversation).toHaveBeenCalledWith(conversationId, { projectId });
    expect(client.listConversationEvents).toHaveBeenCalledWith(conversationId, { projectId, after: "0" });
  });
});
