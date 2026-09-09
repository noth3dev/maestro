import { describe, expect, it, vi } from "vitest";
import { CapabilityApprovalExpiredError, CapabilityApprovalRevokedError } from "@maestro/persistence";
import type {
  CapabilityApproval,
  CapabilityApprovalInput,
  CapabilityConsumptionInput,
  CapabilitySession,
  CapabilitySessionInput,
  RepetitionScope,
} from "@maestro/persistence";
import {
  CapabilityApprovalEscalationError,
  CapabilityApprovalUnauthorizedError,
  createCapabilityApprovalService,
  type CapabilityApprovalRequest,
  type ApprovalActor,
  type CapabilityApprovalLedger,
} from "./capability-approval-service.js";

const ids = { projectId: "project-1", goalId: "goal-1", commandId: "command-1", approvalId: "approval-1", sessionId: "session-1" };
const scope: RepetitionScope = { kind: "one_execution" };
const baseRequest: CapabilityApprovalRequest = {
  approvalId: ids.approvalId,
  capabilityKind: "ipython",
  projectId: ids.projectId,
  goalId: ids.goalId,
  commandId: ids.commandId,
  action: "project.file.edit",
  target: "src/server.ts",
  effects: [{ action: "project.file.edit", target: "src/server.ts" }],
  pressure: 50,
  policyVersion: 1,
  controlEpoch: "1",
  budgetEffectCents: 0,
  requiredTier: "Department Head",
  expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  repetitionScope: scope,
  saferAlternative: "Prepare a patch without applying it.",
  sessionId: ids.sessionId,
  fullAccessMode: "retain_intermediate_approvals",
};

function approval(input: CapabilityApprovalInput): CapabilityApproval {
  return { ...input, createdAt: new Date("2029-01-01T00:00:00.000Z"), revokedAt: null };
}
function fakeLedger(): CapabilityApprovalLedger & { approvals: CapabilityApproval[]; sessions: CapabilitySession[] } {
  const ledger = {
    approvals: [] as CapabilityApproval[],
    sessions: [] as CapabilitySession[],
    createApproval: vi.fn(async (input: CapabilityApprovalInput) => { const result = approval(input); ledger.approvals.push(result); return result; }),
    setSession: vi.fn(async (input: CapabilitySessionInput) => { const result = { ...input, selectedAt: new Date("2029-01-01T00:00:00.000Z") }; ledger.sessions.push(result); return result; }),
    getSession: vi.fn(async (capabilityKind: string, projectId: string, goalId: string) => ledger.sessions.findLast((session) => session.capabilityKind === capabilityKind && session.projectId === projectId && session.goalId === goalId)),
    consumeApproval: vi.fn(async (_input: CapabilityConsumptionInput) => ({ consumed: true, remainingCount: 0, remainingBudgetCents: null })),
  } satisfies CapabilityApprovalLedger & { approvals: CapabilityApproval[]; sessions: CapabilitySession[] };
  return ledger;
}
function actors() {
  return {
    head: { actorId: "head-engineering", kind: "department_head", projectId: ids.projectId, goalId: ids.goalId, active: true, departmentId: "engineering" } satisfies ApprovalActor,
    outsideHead: { actorId: "head-quality", kind: "department_head", projectId: ids.projectId, goalId: ids.goalId, active: true, departmentId: "quality" } satisfies ApprovalActor,
    council: { actorId: "council-1", kind: "encore_council", projectId: ids.projectId, goalId: ids.goalId, active: true } satisfies ApprovalActor,
    user: { actorId: "user-1", kind: "user", projectId: ids.projectId, goalId: ids.goalId, active: true } satisfies ApprovalActor,
  };
}
function service(ledger: ReturnType<typeof fakeLedger>, resolved = actors()) {
  return createCapabilityApprovalService({
    ledger,
    resolveDepartmentHead: async () => resolved.head,
    resolveEncoreCouncil: async () => resolved.council,
    authorizeActor: async () => true,
    clock: () => new Date("2029-01-01T00:00:00.000Z"),
  });
}

describe("capability approval hierarchy", () => {
  it("resolves tier 2 only at the active Goal-scoped Department Head", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    await expect(svc.approve(baseRequest, actors().outsideHead)).rejects.toBeInstanceOf(CapabilityApprovalUnauthorizedError);
    const result = await svc.approve(baseRequest, actors().head);
    expect(result.approval.approverId).toBe("head-engineering");
  });

  it("rejects a resolver actor that is not bound to the requested Goal", async () => {
    const ledger = fakeLedger();
    const resolved = actors();
    const svc = createCapabilityApprovalService({
      ledger,
      resolveDepartmentHead: async () => ({ ...resolved.head, goalId: "other-goal" }),
      resolveEncoreCouncil: async () => resolved.council,
      authorizeActor: async () => true,
      clock: () => new Date("2029-01-01T00:00:00.000Z"),
    });
    await expect(svc.approve(baseRequest, actors().head)).rejects.toBeInstanceOf(CapabilityApprovalUnauthorizedError);
  });

  it("routes Head disagreement to Encore Council instead of resolving locally", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    const result = await svc.approve({ ...baseRequest, headDisagreement: true }, actors().council);
    expect(result.approval.tier).toBe("Encore Council");
    expect(result.approval.approverId).toBe("council-1");
  });

  it("requires the user at tier 4 in both full-access modes", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    for (const mode of ["retain_intermediate_approvals", "skip_intermediate_approvals"] as const) {
      await svc.selectFullAccessMode({ ...baseRequest, fullAccessMode: mode }, actors().user);
      const tier4Request = { ...baseRequest, effects: [{ action: "git.remote.push", target: "origin/main" }], action: "git.remote.push", target: "origin/main", requiredTier: "user" as const, fullAccessMode: mode };
      await expect(svc.approve(tier4Request, actors().head)).rejects.toBeInstanceOf(CapabilityApprovalUnauthorizedError);
      const result = await svc.approve(tier4Request, actors().user);
      expect(result.approval.tier).toBe("user");
    }
  });

  it("allows a direct tier-4 user approval without requiring a full-access session", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    const result = await svc.approve({ ...baseRequest, effects: [{ action: "git.remote.push", target: "origin/main" }], action: "git.remote.push", target: "origin/main", requiredTier: "user", sessionId: undefined, fullAccessMode: undefined }, actors().user);
    expect(result).toMatchObject({ status: "approved", approval: { tier: "user", approverId: "user-1" } });
  });

  it("skips only tiers 2 and 3 in the user-selected per-session mode", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    await svc.selectFullAccessMode({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals" }, actors().user);
    const result = await svc.approve({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals" }, actors().user);
    expect(result).toMatchObject({ status: "intermediate_skipped", skippedTier: "Department Head" });
    expect(ledger.createApproval).not.toHaveBeenCalled();
  });

  it("does not let an inactive or out-of-scope user skip intermediate tiers", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    await svc.selectFullAccessMode({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals" }, actors().user);
    await expect(svc.approve({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals" }, { ...actors().user, goalId: "other-goal" })).rejects.toBeInstanceOf(CapabilityApprovalUnauthorizedError);
    await expect(svc.approve({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals" }, { ...actors().user, active: false })).rejects.toBeInstanceOf(CapabilityApprovalUnauthorizedError);
  });

  it("rejects skip mode when the request omits the selected session identity", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    await svc.selectFullAccessMode({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals" }, actors().user);
    await expect(svc.approve({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals", sessionId: undefined }, actors().user)).rejects.toBeInstanceOf(CapabilityApprovalUnauthorizedError);
  });

  it("does not resolve a Head disagreement locally when Encore is unavailable", async () => {
    const ledger = fakeLedger();
    const svc = createCapabilityApprovalService({
      ledger,
      resolveDepartmentHead: async () => actors().head,
      resolveEncoreCouncil: async () => undefined,
      authorizeActor: async () => true,
      clock: () => new Date("2029-01-01T00:00:00.000Z"),
    });
    await expect(svc.approve({ ...baseRequest, headDisagreement: true }, actors().head)).rejects.toBeInstanceOf(CapabilityApprovalEscalationError);
    expect(ledger.createApproval).not.toHaveBeenCalled();
  });

  it("rejects a caller-supplied lower tier for a critical classified effect", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    await expect(svc.approve({ ...baseRequest, action: "git.remote.push", target: "origin/main", effects: [{ action: "git.remote.push", target: "origin/main" }], requiredTier: "Department Head" }, actors().head)).rejects.toThrow("requiredTier does not match");
    expect(ledger.createApproval).not.toHaveBeenCalled();
  });

  it("reproduces D3: retained intermediates, skipped intermediates, and non-skippable user tier", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    const retained = "retain_intermediate_approvals" as const;
    const skipped = "skip_intermediate_approvals" as const;
    await svc.selectFullAccessMode({ ...baseRequest, fullAccessMode: retained }, actors().user);
    const headApproval = await svc.approve({ ...baseRequest, fullAccessMode: retained }, actors().head);
    expect(headApproval.status).toBe("approved");
    const encoreRequest = { ...baseRequest, pressure: 100, requiredTier: "Encore Council" as const, fullAccessMode: retained };
    const encoreApproval = await svc.approve(encoreRequest, actors().council);
    expect(encoreApproval.status).toBe("approved");

    await svc.selectFullAccessMode({ ...baseRequest, fullAccessMode: skipped }, actors().user);
    const skipHead = await svc.approve({ ...baseRequest, fullAccessMode: skipped }, actors().user);
    expect(skipHead).toMatchObject({ status: "intermediate_skipped", skippedTier: "Department Head" });
    const skipEncore = await svc.approve({ ...encoreRequest, fullAccessMode: skipped }, actors().user);
    expect(skipEncore).toMatchObject({ status: "intermediate_skipped", skippedTier: "Encore Council" });
    const tier4 = await svc.approve({ ...baseRequest, action: "git.remote.push", target: "origin/main", effects: [{ action: "git.remote.push", target: "origin/main" }], requiredTier: "user", fullAccessMode: skipped }, actors().user);
    expect(tier4).toMatchObject({ status: "approved", approval: { tier: "user", approverId: "user-1" } });
  });

  it("records rejection as an explicit safer alternative and never downgrades", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    const result = await svc.reject(baseRequest, actors().head);
    expect(result).toMatchObject({ status: "rejected", alternative: baseRequest.saferAlternative });
    expect(ledger.approvals[0]).toMatchObject({ decision: "safer_alternative", tier: "Department Head" });
    expect(ledger.createApproval).toHaveBeenCalledWith(expect.objectContaining({ saferAlternative: baseRequest.saferAlternative }));
  });

  it("propagates revoked and expired approval failures before execution", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    const revoked = new CapabilityApprovalRevokedError("Capability approval is revoked");
    ledger.consumeApproval.mockRejectedValueOnce(revoked);
    await expect(svc.consume({ ...baseRequest, approvalId: ids.approvalId })).rejects.toBe(revoked);
    const expired = new CapabilityApprovalExpiredError("Capability approval is expired");
    ledger.consumeApproval.mockRejectedValueOnce(expired);
    await expect(svc.consume({ ...baseRequest, approvalId: ids.approvalId })).rejects.toBe(expired);
    expect(ledger.consumeApproval).toHaveBeenCalledTimes(2);
  });
});
