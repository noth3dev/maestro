import { describe, expect, it } from "vitest";
import { evaluateAction, type ActionRequest, type AuthorityRecord } from "./authority.js";

const request: ActionRequest = {
  commandId: "command-1",
  actorId: "actor-1",
  goalId: "goal-1",
  action: "git.remote.push",
  target: "origin/main",
  policyVersion: 1,
  budgetEffectCents: 0,
};

const exactApproval: AuthorityRecord = {
  recordId: "approval-1",
  kind: "approval",
  commandId: "command-1",
  actorId: "actor-1",
  goalId: "goal-1",
  action: "git.remote.push",
  target: "origin/main",
  policyVersion: 1,
  expiresAt: new Date("2030-01-01T00:00:00Z"),
};

const now = new Date("2029-01-01T00:00:00Z");

describe("evaluateAction", () => {
  it("derives critical classification instead of trusting caller input", () => {
    const malicious = { ...request, classification: "ordinary" } as unknown as ActionRequest;
    expect(evaluateAction(malicious, [], now)).toMatchObject({
      effect: "require_approval",
      reason: "critical_action",
      classification: "critical",
    });
  });

  it("fails closed for an unknown action", () => {
    expect(evaluateAction({ ...request, action: "typo.push" }, [], now)).toMatchObject({
      effect: "deny",
      reason: "ambiguous_action",
      classification: "ambiguous",
    });
  });

  it("allows a critical action only with an exact command-bound approval", () => {
    expect(evaluateAction(request, [exactApproval], now)).toMatchObject({
      effect: "allow",
      reason: "exact_approval",
      classification: "critical",
      recordId: "approval-1",
      request,
    });
    expect(evaluateAction({ ...request, commandId: "command-2" }, [exactApproval], now)).toMatchObject({
      effect: "require_approval",
    });
  });

  it("rejects expired and revoked approvals with explicit reasons", () => {
    expect(evaluateAction(request, [exactApproval], new Date("2031-01-01T00:00:00Z"))).toMatchObject({ effect: "require_approval", reason: "expired_approval" });
    expect(evaluateAction(request, [{ ...exactApproval, revokedAt: now }], now)).toMatchObject({ effect: "require_approval", reason: "revoked_approval" });
  });

  it("allows ordinary work only with an exact scoped grant", () => {
    const ordinary: ActionRequest = { ...request, commandId: "edit-1", action: "project.file.edit", target: "/repo" };
    const grant: AuthorityRecord = { ...exactApproval, recordId: "grant-1", kind: "grant", commandId: null, action: ordinary.action, target: ordinary.target };
    expect(evaluateAction(ordinary, [], now)).toMatchObject({ effect: "deny", reason: "no_grant", classification: "ordinary" });
    expect(evaluateAction(ordinary, [grant], now)).toMatchObject({ effect: "allow", reason: "exact_grant", recordId: "grant-1" });
  });

  it("denies actions forbidden by policy", () => {
    expect(evaluateAction({ ...request, action: "system.policy.bypass" }, [exactApproval], now)).toMatchObject({ effect: "deny", reason: "forbidden", classification: "forbidden" });
  });
});
