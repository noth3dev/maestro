import { describe, expect, it, vi } from "vitest";
import { buildServer, type ConversationService } from "./server.js";
import type { GoalService, OperatorAuthenticator } from "./server.js";
import { ModelGatewayClientError } from "./model-gateway-client.js";

const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const goalId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02";
const conversationId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03";
const operator = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };
const conversation = { conversationId, projectId, goalId, model: "openai/gpt-5", status: "active" as const, version: 1 };

const goalService = { createGoal: vi.fn(), transitionGoal: vi.fn(), pauseGoal: vi.fn(), stopGoal: vi.fn(), resumeGoal: vi.fn(), emergencyStopGoal: vi.fn(), getGoal: vi.fn() } as unknown as GoalService;
const authenticator: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "authenticated", operator }) };

describe("conversation routes", () => {
  it("creates a conversation and runs a turn through the authenticated service", async () => {
    const create = vi.fn(async () => conversation);
    const turn = vi.fn(async () => ({ conversation: { ...conversation, status: "succeeded" as const, version: 2 }, turn: { turnId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", conversationId, role: "assistant" as const, content: "Hello from Maestro", status: "completed" as const, cursor: "2", createdAt: "2025-01-01T00:00:00.000Z" } }));
    const service: ConversationService = { listModels: vi.fn(async () => []), create, get: vi.fn(), turn, cancel: vi.fn(), listEvents: vi.fn(async () => []) };
    const app = buildServer({ goalService, authenticator, conversationService: service });
    const created = await app.inject({ method: "POST", url: "/v1/conversations", headers: { authorization: "Bearer test-secret", "content-type": "application/json", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f09" }, payload: { projectId, goalId, model: "openai/gpt-5" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(conversation);
    expect(create).toHaveBeenCalledWith({ projectId, goalId, model: "openai/gpt-5" }, operator, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f09");
    const response = await app.inject({ method: "POST", url: `/v1/conversations/${conversationId}/turns`, headers: { authorization: "Bearer test-secret", "content-type": "application/json", "idempotency-key": "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f10" }, payload: { projectId, text: "Hello" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().turn.content).toBe("Hello from Maestro");
    expect(turn).toHaveBeenCalledWith(conversationId, { projectId, text: "Hello" }, operator, "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f10");
    await app.close();
  });


  it("requires idempotency keys for conversation writes", async () => {
    const create = vi.fn(async () => conversation);
    const service: ConversationService = { listModels: vi.fn(async () => []), create, get: vi.fn(), turn: vi.fn(), cancel: vi.fn(), listEvents: vi.fn(async () => []) };
    const app = buildServer({ goalService, authenticator, conversationService: service });

    const response = await app.inject({ method: "POST", url: "/v1/conversations", headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, payload: { projectId, goalId, model: "openai/gpt-5" } });

    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });

  it("lists bounded conversation history through the authenticated route", async () => {
    const event = { cursor: "2", eventId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", conversationId, projectId, eventType: "turn_delta" as const, payload: { turnId: conversationId, text: "hello" }, occurredAt: "2025-01-01T00:00:00.000Z" };
    const listEvents = vi.fn(async () => [event]);
    const service: ConversationService = { listModels: vi.fn(async () => []), create: vi.fn(), get: vi.fn(), turn: vi.fn(), cancel: vi.fn(), listEvents };
    const app = buildServer({ goalService, authenticator, conversationService: service });

    const response = await app.inject({ method: "GET", url: `/v1/conversations/${conversationId}/events?projectId=${projectId}&after=1`, headers: { authorization: "Bearer test-secret" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([event]);
    expect(listEvents).toHaveBeenCalledWith(conversationId, projectId, "1", operator);
    await app.close();
  });

  it("does not expose provider or credential details in gateway errors", async () => {
    const service: ConversationService = {
      listModels: vi.fn(async () => { throw new ModelGatewayClientError("provider_unavailable", 502, "upstream Bearer super-secret-provider-token failed"); }),
      create: vi.fn(), get: vi.fn(), turn: vi.fn(), cancel: vi.fn(), listEvents: vi.fn(async () => []),
    };
    const app = buildServer({ goalService, authenticator, conversationService: service });
    const response = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: "Bearer test-secret" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "provider_unavailable", message: "Provider is currently unavailable" } });
    expect(response.body).not.toContain("super-secret-provider-token");
    await app.close();
  });

  it("requires project membership and exposes model catalog without account material", async () => {
    const listModels = vi.fn(async () => [{ identity: { provider: "openai", id: "gpt-5" }, capabilities: ["text"], authModes: ["api-key"], dataPolicy: { allowedDataClasses: ["public"], retention: "provider-policy", trainsOnCustomerData: false, regions: ["US"] } }]);
    const membership = { assertProjectMembership: vi.fn(async () => {}) };
    const service: ConversationService = { listModels, create: vi.fn(), get: vi.fn(), turn: vi.fn(), cancel: vi.fn(), listEvents: vi.fn(async () => []) };
    const app = buildServer({ goalService, authenticator, projectMembership: membership, conversationService: service });
    const response = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: "Bearer test-secret" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0]).toMatchObject({ identity: { provider: "openai", id: "gpt-5" } });
    expect(response.json()[0]).not.toHaveProperty("accountRef");
    await app.close();
  });
});
