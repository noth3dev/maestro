import { describe, expect, it } from "vitest";
import { evaluateAction, type ActionRequest, type AuthorityRecord } from "./authority.js";

const request: ActionRequest = {
  actorId: "actor-1",
  goalId: "goal-1",
  action: "git.remote.push",
  target: "origin/main",
  classification: "critical",
  policyVersion: 1,
};

const exactApproval: AuthorityRecord = {
  kind: "approval",
  actorId: "actor-1",
  goalId: "goal-1",
  action: "git.remote.push",
  target: "origin/main",
  policyVersion: 1,
  expiresAt: new Date("2030-01-01T00:00:00Z"),
};

describe("evaluateAction", () => {
  it("requires exact approval for a critical action", () => {
    expect(evaluateAction(request, [], new Date("2029-01-01T00:00:00Z"))).toEqual({
      effect: "require_approval",
      reason: "critical_action",
    });
  });

  it("allows a critical action with an exact unexpired approval", () => {
    expect(evaluateAction(request, [exactApproval], new Date("2029-01-01T00:00:00Z"))).toEqual({
      effect: "allow",
      reason: "exact_approval",
    });
  });

  it("denies a mismatched target", () => {
    expect(evaluateAction({ ...request, target: "origin/release" }, [exactApproval], new Date("2029-01-01T00:00:00Z"))).toEqual({
      effect: "require_approval",
      reason: "critical_action",
    });
  });

  it("denies an expired approval", () => {
    expect(evaluateAction(request, [exactApproval], new Date("2031-01-01T00:00:00Z"))).toEqual({
      effect: "require_approval",
      reason: "critical_action",
    });
  });

  it("denies forbidden and ambiguous actions", () => {
    expect(evaluateAction({ ...request, classification: "forbidden" }, [exactApproval], new Date())).toEqual({ effect: "deny", reason: "forbidden" });
    expect(evaluateAction({ ...request, classification: "ambiguous" }, [exactApproval], new Date())).toEqual({ effect: "deny", reason: "ambiguous" });
  });

  it("allows ordinary work only with an exact grant", () => {
    const ordinary = { ...request, action: "project.file.edit", target: "/repo", classification: "ordinary" } as const;
    const grant: AuthorityRecord = { ...exactApproval, kind: "grant", action: ordinary.action, target: ordinary.target };
    expect(evaluateAction(ordinary, [], new Date("2029-01-01T00:00:00Z"))).toEqual({ effect: "deny", reason: "no_grant" });
    expect(evaluateAction(ordinary, [grant], new Date("2029-01-01T00:00:00Z"))).toEqual({ effect: "allow", reason: "exact_grant" });
  });
});
