import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthorityRecord, AuthorityRepository, ControlRecheck } from "@maestro/authority";
import { createCriticalActionService } from "./critical-action-service.js";
import { buildServer, type GoalService, type OperatorAuthenticator } from "./server.js";

const operator = { operatorId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", credentialId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06" };
const goal = { goalId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02", projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01", state: "active" as const, version: 1 };

function authenticated(outcome: "authenticated" | "invalid" = "authenticated"): OperatorAuthenticator {
  return {
    authenticateBearerSecret: async () =>
      outcome === "authenticated" ? { outcome: "authenticated", operator } : { outcome: "invalid" },
  };
}

function fakeGoalService(): GoalService {
  return {
    createGoal: async () => goal,
    transitionGoal: async () => goal,
    pauseGoal: async () => goal,
    stopGoal: async () => goal,
    resumeGoal: async () => goal,
    emergencyStopGoal: async () => ({ ...goal, state: "stopped" }),
    getGoal: async () => goal,
  };
}

function fakeRepository(overrides: Partial<AuthorityRepository> = {}): AuthorityRepository {
  return {
    load: async () => [],
    appendDecision: async () => {},
    recheckControl: async (): Promise<ControlRecheck> => ({ effect: "allow" }),
    ...overrides,
  };
}

function requestBody(overrides: Partial<{ projectId: string; action: string; target: string; policyVersion: number; budgetEffectCents: number }> = {}) {
  return { projectId: goal.projectId, action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0, ...overrides };
}

describe("critical-action route wired to the real durable authority gateway", () => {
  it("requires bearer auth before reaching the authority gateway at all", async () => {
    const effect = vi.fn(async () => {});
    const criticalActionService = createCriticalActionService({ repository: fakeRepository(), effect, getControlEpoch: async () => "1" });
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated("invalid"), criticalActionService });

    const response = await app.inject({
      method: "POST",
      url: `/v1/goals/${goal.goalId}/critical-actions`,
      headers: { "idempotency-key": randomUUID() },
      payload: requestBody(),
    });

    expect(response.statusCode).toBe(401);
    expect(effect).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns a stable 409 and never invokes the effect callback when no approval has been bootstrapped", async () => {
    const effect = vi.fn(async () => {});
    const criticalActionService = createCriticalActionService({ repository: fakeRepository(), effect, getControlEpoch: async () => "1" });
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated(), criticalActionService });

    const response = await app.inject({
      method: "POST",
      url: `/v1/goals/${goal.goalId}/critical-actions`,
      headers: { authorization: "Bearer test-secret", "idempotency-key": randomUUID() },
      payload: requestBody(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: "critical_action_requires_approval", message: expect.stringContaining("critical_action") } });
    expect(effect).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns a stable 403 and never invokes the effect callback when the Goal control latch denies the request", async () => {
    const effect = vi.fn(async () => {});
    const criticalActionService = createCriticalActionService({
      repository: fakeRepository({ recheckControl: async () => ({ effect: "deny", reason: "emergency_stop" }) }),
      effect,
      getControlEpoch: async () => "1",
    });
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated(), criticalActionService });

    const response = await app.inject({
      method: "POST",
      url: `/v1/goals/${goal.goalId}/critical-actions`,
      headers: { authorization: "Bearer test-secret", "idempotency-key": randomUUID() },
      payload: requestBody(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "critical_action_denied" } });
    expect(effect).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 200 with the allow decision and invokes the effect callback exactly once for an exact matching approval", async () => {
    const effect = vi.fn(async () => {});
    const commandId = randomUUID();
    const approval: AuthorityRecord = {
      recordId: randomUUID(),
      kind: "approval",
      commandId,
      projectId: goal.projectId,
      actorId: operator.operatorId,
      goalId: goal.goalId,
      action: "git.remote.push",
      target: "origin/main",
      policyVersion: 1,
      budgetEffectCents: 0,
      expiresAt: new Date("2999-01-01T00:00:00Z"),
    };
    const criticalActionService = createCriticalActionService({
      repository: fakeRepository({ load: async () => [approval] }),
      effect,
      getControlEpoch: async () => "1",
    });
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated(), criticalActionService });

    const response = await app.inject({
      method: "POST",
      url: `/v1/goals/${goal.goalId}/critical-actions`,
      headers: { authorization: "Bearer test-secret", "idempotency-key": commandId },
      payload: requestBody(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ goalId: goal.goalId, effect: "allow", recordId: approval.recordId });
    expect(effect).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("returns the durable_store_unavailable error and never invokes the effect when no critical-action service is injected", async () => {
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated() });

    const response = await app.inject({
      method: "POST",
      url: `/v1/goals/${goal.goalId}/critical-actions`,
      headers: { authorization: "Bearer test-secret", "idempotency-key": randomUUID() },
      payload: requestBody(),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "durable_store_unavailable" } });
    await app.close();
  });

  it("rejects an invalid body without invoking the effect callback", async () => {
    const effect = vi.fn(async () => {});
    const criticalActionService = createCriticalActionService({ repository: fakeRepository(), effect, getControlEpoch: async () => "1" });
    const app = buildServer({ goalService: fakeGoalService(), authenticator: authenticated(), criticalActionService });

    const response = await app.inject({
      method: "POST",
      url: `/v1/goals/${goal.goalId}/critical-actions`,
      headers: { authorization: "Bearer test-secret", "idempotency-key": randomUUID() },
      payload: { projectId: goal.projectId, action: "git.remote.push" },
    });

    expect(response.statusCode).toBe(400);
    expect(effect).not.toHaveBeenCalled();
    await app.close();
  });
});
