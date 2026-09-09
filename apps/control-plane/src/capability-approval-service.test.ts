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
    getSession: vi.fn(async (_capabilityKind: string, _projectId: string, _goalId: string) => ledger.sessions.at(-1)),
    consumeApproval: vi.fn(async (_input: CapabilityConsumptionInput) => ({ consumed: true, remainingCount: 0, remainingBudgetCents: null })),
  } satisfies CapabilityApprovalLedger & { approvals: CapabilityApproval[]; sessions: CapabilitySession[] };
  return ledger;
}
function actors() {
  return {
    head: { actorId: "head-engineering", kind: "department_head", departmentId: "engineering" } satisfies ApprovalActor,
    outsideHead: { actorId: "head-quality", kind: "department_head", departmentId: "quality" } satisfies ApprovalActor,
    council: { actorId: "council-1", kind: "encore_council" } satisfies ApprovalActor,
    user: { actorId: "user-1", kind: "user" } satisfies ApprovalActor,
  };
}
function service(ledger: ReturnType<typeof fakeLedger>, resolved = actors()) {
  return createCapabilityApprovalService({
    ledger,
    resolveDepartmentHead: async () => resolved.head,
    resolveEncoreCouncil: async () => resolved.council,
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

  it("routes Head disagreement to Encore Council instead of resolving locally", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    const result = await svc.approve({ ...baseRequest, headDisagreement: true, requiredTier: "Encore Council" }, actors().council);
    expect(result.approval.tier).toBe("Encore Council");
    expect(result.approval.approverId).toBe("council-1");
  });

  it("requires the user at tier 4 in both full-access modes", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    for (const mode of ["retain_intermediate_approvals", "skip_intermediate_approvals"] as const) {
      await svc.selectFullAccessMode({ ...baseRequest, fullAccessMode: mode }, actors().user);
      await expect(svc.approve({ ...baseRequest, requiredTier: "user", fullAccessMode: mode }, actors().head)).rejects.toBeInstanceOf(CapabilityApprovalUnauthorizedError);
      const result = await svc.approve({ ...baseRequest, requiredTier: "user", fullAccessMode: mode }, actors().user);
      expect(result.approval.tier).toBe("user");
    }
  });

  it("skips only tiers 2 and 3 in the user-selected per-session mode", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    await svc.selectFullAccessMode({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals" }, actors().user);
    const result = await svc.approve({ ...baseRequest, fullAccessMode: "skip_intermediate_approvals" }, actors().user);
    expect(result).toMatchObject({ status: "intermediate_skipped", skippedTier: "Department Head" });
    expect(ledger.createApproval).not.toHaveBeenCalled();
  });

  it("does not resolve a Head disagreement locally when Encore is unavailable", async () => {
    const ledger = fakeLedger();
    const svc = createCapabilityApprovalService({
      ledger,
      resolveDepartmentHead: async () => actors().head,
      resolveEncoreCouncil: async () => undefined,
      clock: () => new Date("2029-01-01T00:00:00.000Z"),
    });
    await expect(svc.approve({ ...baseRequest, headDisagreement: true, requiredTier: "Encore Council" }, actors().head)).rejects.toBeInstanceOf(CapabilityApprovalEscalationError);
    expect(ledger.createApproval).not.toHaveBeenCalled();
  });

  it("records rejection as an explicit safer alternative and never downgrades", async () => {
    const ledger = fakeLedger();
    const svc = service(ledger);
    const result = await svc.reject(baseRequest, actors().head);
    expect(result).toMatchObject({ status: "rejected", alternative: baseRequest.saferAlternative });
    expect(ledger.approvals[0]).toMatchObject({ decision: "safer_alternative", tier: "Department Head" });
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
