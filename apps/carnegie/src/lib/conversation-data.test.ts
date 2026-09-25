import { describe, expect, it, vi } from "vitest";
import { cancelHomeTurn, loadConversation, type GoalLessIntakeApi } from "./conversation-data.js";

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

  it("continues loading durable event pages after the 256-event boundary", async () => {
    const client = api();
    const pageOne = Array.from({ length: 256 }, (_, index) => ({
      cursor: String(index + 1),
      eventId: `44444444-4444-4444-8444-${(index + 1).toString(16).padStart(12, "0")}`,
      conversationId,
      projectId,
      eventType: "turn_started" as const,
      payload: { turnId, text: `turn ${index + 1}` },
      occurredAt: "2026-09-21T00:00:00.000Z",
    }));
    const pageTwo = [{
      cursor: "257",
      eventId: "55555555-5555-4555-8555-555555555555",
      conversationId,
      projectId,
      eventType: "turn_completed" as const,
      payload: { turnId, status: "succeeded", content: "latest" },
      occurredAt: "2026-09-21T00:00:01.000Z",
    }];
    vi.mocked(client.listConversationEvents).mockResolvedValueOnce(pageOne).mockResolvedValueOnce(pageTwo);

    await loadConversation(client, { conversationId, projectId });

    expect(client.listConversationEvents).toHaveBeenNthCalledWith(1, conversationId, { projectId, after: "0" });
    expect(client.listConversationEvents).toHaveBeenNthCalledWith(2, conversationId, { projectId, after: "256" });
  });

  it("fails closed when the conversation or an event crosses the project boundary", async () => {
    const client = api();
    vi.mocked(client.getConversation).mockResolvedValueOnce({ conversationId: "99999999-9999-4999-8999-999999999999", projectId, goalId: null, model: "openai/gpt-5", status: "succeeded", version: 2 });
    await expect(loadConversation(client, { conversationId, projectId })).rejects.toThrow("conversation boundary mismatch");

    const eventClient = api();
    vi.mocked(eventClient.listConversationEvents).mockResolvedValueOnce([{ ...((await eventClient.listConversationEvents(conversationId, { projectId, after: "0" }))[0]!), conversationId: "99999999-9999-4999-8999-999999999999" }]);
    await expect(loadConversation(eventClient, { conversationId, projectId })).rejects.toThrow("event boundary mismatch");
  });

  it("uses the server cancellation status instead of assuming the turn was cancelled", async () => {
    const client = api();
    vi.mocked(client.cancelConversation).mockResolvedValueOnce({
      conversationId,
      projectId,
      goalId: null,
      model: "openai/gpt-5",
      status: "unknown",
      version: 2,
    });

    const result = await cancelHomeTurn(client, { conversationId, projectId });

    expect(result).toEqual({ status: "unknown" });
    expect(client.cancelConversation).toHaveBeenCalledTimes(1);
    expect(client.cancelConversation).toHaveBeenCalledWith(conversationId, { projectId });
  });

  it("preserves a completed outcome when completion wins a cancellation race", async () => {
    const client = api();
    vi.mocked(client.cancelConversation).mockResolvedValueOnce({
      conversationId,
      projectId,
      goalId: null,
      model: "openai/gpt-5",
      status: "succeeded",
      version: 3,
    });

    await expect(cancelHomeTurn(client, { conversationId, projectId })).resolves.toEqual({ status: "completed" });
  });

  it("reports a rejected cancellation request as unknown instead of turn failure", async () => {
    const client = api();
    vi.mocked(client.cancelConversation).mockRejectedValueOnce(new Error("cancel request timed out"));

    await expect(cancelHomeTurn(client, { conversationId, projectId })).resolves.toEqual({
      status: "unknown",
      error: "cancel request timed out",
    });
  });
});
