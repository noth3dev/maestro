import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ActionRequest, AuthorityDecisionAudit, AuthorityRecord, AuthorityRepository, ControlRecheck } from "@maestro/authority";
import { createCriticalActionService } from "./critical-action-service.js";

const operator = { operatorId: "operator-1", credentialId: "credential-1" };

function fakeRepository(overrides: Partial<AuthorityRepository> = {}): AuthorityRepository {
  return {
    load: async () => [],
    appendDecision: async () => {},
    recheckControl: async (): Promise<ControlRecheck> => ({ effect: "allow" }),
    ...overrides,
  };
}

describe("critical action service", () => {
  it("evaluates git.remote.push as critical and requires approval without any bootstrapped approval, never invoking the effect", async () => {
    const effect = vi.fn(async () => {});
    const service = createCriticalActionService({
      repository: fakeRepository(),
      effect,
      getControlEpoch: async () => "1",
    });
    const goalId = randomUUID();
    const decision = await service.performCriticalAction(
      goalId,
      { projectId: randomUUID(), action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0 },
      randomUUID(),
      operator,
    );

    expect(decision).toMatchObject({ effect: "require_approval", classification: "critical" });
    expect(effect).not.toHaveBeenCalled();
  });

  it("allows and invokes the effect exactly once for an exact matching approval record", async () => {
    const effect = vi.fn(async () => {});
    const projectId = randomUUID();
    const goalId = randomUUID();
    const commandId = randomUUID();
    const approval: AuthorityRecord = {
      recordId: randomUUID(),
      kind: "approval",
      commandId,
      projectId,
      actorId: operator.operatorId,
      goalId,
      action: "git.remote.push",
      target: "origin/main",
      policyVersion: 1,
      budgetEffectCents: 0,
      expiresAt: new Date("2999-01-01T00:00:00Z"),
    };
    const service = createCriticalActionService({
      repository: fakeRepository({ load: async () => [approval] }),
      effect,
      getControlEpoch: async () => "1",
    });

    const decision = await service.performCriticalAction(
      goalId,
      { projectId, action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0 },
      commandId,
      operator,
    );

    expect(decision).toMatchObject({ effect: "allow", recordId: approval.recordId });
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("denies and never invokes the effect when the Goal control latch dominates an otherwise active approval", async () => {
    const effect = vi.fn(async () => {});
    const projectId = randomUUID();
    const goalId = randomUUID();
    const commandId = randomUUID();
    const approval: AuthorityRecord = {
      recordId: randomUUID(),
      kind: "approval",
      commandId,
      projectId,
      actorId: operator.operatorId,
      goalId,
      action: "git.remote.push",
      target: "origin/main",
      policyVersion: 1,
      budgetEffectCents: 0,
      expiresAt: new Date("2999-01-01T00:00:00Z"),
    };
    const service = createCriticalActionService({
      repository: fakeRepository({
        load: async () => [approval],
        recheckControl: async () => ({ effect: "deny", reason: "emergency_stop" }),
      }),
      effect,
      getControlEpoch: async () => "1",
    });

    const decision = await service.performCriticalAction(
      goalId,
      { projectId, action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0 },
      commandId,
      operator,
    );

    expect(decision).toMatchObject({ effect: "deny", reason: "emergency_stop" });
    expect(effect).not.toHaveBeenCalled();
  });

  it("audits the decision durably before considering invoking the effect", async () => {
    const audits: AuthorityDecisionAudit[] = [];
    const effect = vi.fn(async () => {});
    const service = createCriticalActionService({
      repository: fakeRepository({ appendDecision: async (audit) => { audits.push(audit); } }),
      effect,
      getControlEpoch: async () => "1",
    });

    await service.performCriticalAction(
      randomUUID(),
      { projectId: randomUUID(), action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0 },
      randomUUID(),
      operator,
    );

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ decision: { effect: "require_approval" } });
  });

  it("builds the ActionRequest from the authenticated operator and the durable control epoch, not client input", async () => {
    let seen: ActionRequest | undefined;
    const effect = vi.fn(async () => {});
    const service = createCriticalActionService({
      repository: fakeRepository({ load: async (request) => { seen = request; return []; } }),
      effect,
      getControlEpoch: async () => "42",
    });
    const goalId = randomUUID();
    const projectId = randomUUID();

    await service.performCriticalAction(
      goalId,
      { projectId, action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0 },
      randomUUID(),
      operator,
    );

    expect(seen).toMatchObject({ actorId: operator.operatorId, goalId, projectId, controlEpoch: "42" });
  });
});
