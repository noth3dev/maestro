import { describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import type { GoalService } from "./server.js";
import type { ChannelService, OperatorAuthenticator } from "./server-ports.js";
import { ProjectMembershipRequiredError } from "@maestro/persistence";

const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";
const goalId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02";
const operator = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };
const message = { messageId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", channelId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f07", sequence: "1", author: { kind: "operator" as const, id: operator.operatorId }, content: "hello", createdAt: "2025-01-01T00:00:00.000Z" };
const read = { channel: { channelId: message.channelId, projectId, goalId, state: "active" as const, kind: "department" as const, scopeId: "engineering", displayName: "#engineering" }, messages: [message], members: [] };
const goalService = { createGoal: vi.fn(), transitionGoal: vi.fn(), pauseGoal: vi.fn(), stopGoal: vi.fn(), resumeGoal: vi.fn(), emergencyStopGoal: vi.fn(), getGoal: vi.fn() } as unknown as GoalService;
const authenticator: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "authenticated", operator }) };

describe("channel routes", () => {
  it("reads and posts a Goal-bound channel through the authenticated service", async () => {
    const get = vi.fn(async () => read);
    const post = vi.fn(async () => message);
    const service: ChannelService = { get, post };
    const app = buildServer({ goalService, authenticator, channelService: service });
    const url = `/v1/goals/${goalId}/channels/department/engineering?projectId=${projectId}`;
    const response = await app.inject({ method: "GET", url, headers: { authorization: "Bearer test-secret" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(read);
    expect(get).toHaveBeenCalledWith({ operatorId: operator.operatorId, projectId, goalId, selector: { kind: "department", channelId: "engineering" } });
    const created = await app.inject({ method: "POST", url: `${url.split("?")[0]}/messages`, headers: { authorization: "Bearer test-secret", "content-type": "application/json", "idempotency-key": message.messageId }, payload: { projectId, content: "hello" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(message);
    expect(post).toHaveBeenCalledWith({ operatorId: operator.operatorId, projectId, goalId, selector: { kind: "department", channelId: "engineering" }, content: "hello", messageId: message.messageId });
    await app.close();
  });

  it("enforces authenticated project membership before reading a channel", async () => {
    const get = vi.fn(async () => read);
    const membership = { assertProjectMembership: vi.fn(async () => { throw new ProjectMembershipRequiredError(operator.operatorId, projectId); }) };
    const app = buildServer({ goalService, authenticator, channelService: { get, post: vi.fn() }, projectMembership: membership });
    const response = await app.inject({ method: "GET", url: `/v1/goals/${goalId}/channels/department/engineering?projectId=${projectId}`, headers: { authorization: "Bearer test-secret" } });
    expect(response.statusCode).toBe(403);
    expect(get).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects malformed selectors and missing idempotency keys before the service", async () => {
    const post = vi.fn(async () => message);
    const app = buildServer({ goalService, authenticator, channelService: { get: vi.fn(async () => read), post } });
    const badSelector = await app.inject({ method: "GET", url: `/v1/goals/${goalId}/channels/department/not-a-department?projectId=${projectId}`, headers: { authorization: "Bearer test-secret" } });
    expect(badSelector.statusCode).toBe(400);
    const missingKey = await app.inject({ method: "POST", url: `/v1/goals/${goalId}/channels/department/engineering/messages`, headers: { authorization: "Bearer test-secret", "content-type": "application/json" }, payload: { projectId, content: "hello" } });
    expect(missingKey.statusCode).toBe(400);
    expect(post).not.toHaveBeenCalled();
    await app.close();
  });
});
