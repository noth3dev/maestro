import { describe, expect, it, vi } from "vitest";
import type { ProjectionReadModel } from "@maestro/contracts";
import { buildServer } from "./server.js";
import type { OperatorAuthenticator } from "./server-ports.js";
import type { ProjectionService } from "./projection-service.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const operator = { operatorId: "22222222-2222-4222-8222-222222222222", credentialId: "33333333-3333-4333-8333-333333333333" };
const projection: ProjectionReadModel = { nodes: [], edges: [], eventCursor: "0" };
const authenticated: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "authenticated", operator }) };

function goalService() {
  return { createGoal: async () => ({ goalId: projectId, projectId, state: "draft" as const, version: 0 }), transitionGoal: async () => ({ goalId: projectId, projectId, state: "active" as const, version: 1 }), getGoal: async () => ({ goalId: projectId, projectId, state: "active" as const, version: 1 }) };
}

describe("Projection API route", () => {
  it("reads the scoped projection through the authenticated control plane", async () => {
    const projectionService: ProjectionService = { read: vi.fn(async () => projection), compose: vi.fn(async () => projection) };
    const app = buildServer({ goalService: goalService(), authenticator: authenticated, projectionService });
    const response = await app.inject({ method: "GET", url: `/v1/projection?projectId=${projectId}`, headers: { authorization: "Bearer test-secret" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(projection);
    expect(projectionService.read).toHaveBeenCalledWith({ projectId });
    await app.close();
  });
});
