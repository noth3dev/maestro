import { describe, expect, it } from "vitest";
import type { CapabilityApproval, CapabilityApprovalInput, CapabilityConsumptionInput, CapabilitySession, CapabilitySessionInput } from "@maestro/persistence";
import { createCapabilityApprovalService } from "./capability-approval-service.js";

function harness(now = new Date("2026-01-01T00:00:00Z")) {
  let clock = now; const approvals = new Map<string, CapabilityApproval>();
  const ledger = {
    createApproval: async (input: CapabilityApprovalInput): Promise<CapabilityApproval> => {
      const count = input.repetitionScope.kind === "one_execution" ? 1 : input.repetitionScope.kind === "bounded_count" ? input.repetitionScope.count : null;
      const budget = input.repetitionScope.kind === "bounded_budget" ? input.repetitionScope.budgetCents : null;
      const repetitionExpiresAt = input.repetitionScope.kind === "bounded_time" ? input.repetitionScope.expiresAt : null;
      const approval = { ...input, createdAt: clock, revokedAt: null, repetitionRemainingCount: count, repetitionRemainingBudgetCents: budget, repetitionExpiresAt, repetitionScope: input.repetitionScope };
      approvals.set(input.approvalId, approval); return approval;
    },
    setSession: async (input: CapabilitySessionInput): Promise<CapabilitySession> => ({ ...input, selectedAt: clock }), getSession: async () => undefined,
    getApproval: async (approvalId: string) => [...approvals.values()].find((approval) => approval.approvalId === approvalId),
    findApproval: async (kind: string, projectId: string, goalId: string) => [...approvals.values()].find((approval) => approval.capabilityKind === kind && approval.projectId === projectId && approval.goalId === goalId),
    revokeApproval: async (approvalId: string) => { const approval = approvals.get(approvalId)!; approvals.set(approvalId, { ...approval, revokedAt: clock }); },
    consumeApproval: async (input: CapabilityConsumptionInput) => {
      const approval = approvals.get(input.approvalId)!; const current = approval.repetitionRemainingCount;
      if (current !== null) approvals.set(input.approvalId, { ...approval, repetitionRemainingCount: current - 1 });
      return { consumed: true, remainingCount: current === null ? null : current - 1, remainingBudgetCents: approval.repetitionRemainingBudgetCents };
    },
  };
  const service = createCapabilityApprovalService({ ledger, clock: () => clock, resolveDepartmentHead: async () => undefined, resolveEncoreCouncil: async () => undefined, authorizeActor: async () => true });
  return { service, actor: { actorId: "user", kind: "user" as const, projectId: "project", goalId: "goal", active: true }, advance: (date: string) => { clock = new Date(date); } };
}

describe("external capability activation", () => {
  it("keeps local full-access mode separate from external activation", async () => {
    const { service, actor } = harness();
    await service.selectFullAccessMode({ capabilityKind: "ipython", projectId: "project", goalId: "goal", sessionId: "session", fullAccessMode: "skip_intermediate_approvals" }, actor);
    await expect(service.isExternalCapabilityActive({ capabilityKind: "browser", projectId: "project", goalId: "goal" })).resolves.toBe(false);
  });

  it.each(["browser", "device", "external-service", "deployment"] as const)("activates %s only for the matching Goal", async (capabilityKind) => {
    const { service, actor } = harness();
    await service.activateExternalCapability({ activationId: `activation-${capabilityKind}`, capabilityKind, projectId: "project", goalId: "goal", expiresAt: new Date("2026-01-02T00:00:00Z"), repetitionScope: { kind: "bounded_count", count: 2 } }, actor);
    await expect(service.isExternalCapabilityActive({ capabilityKind, projectId: "project", goalId: "goal" })).resolves.toBe(true);
    for (const otherKind of ["browser", "device", "external-service", "deployment"] as const) {
      if (otherKind !== capabilityKind) await expect(service.isExternalCapabilityActive({ capabilityKind: otherKind, projectId: "project", goalId: "goal" })).resolves.toBe(false);
    }
    await expect(service.isExternalCapabilityActive({ capabilityKind, projectId: "project", goalId: "other-goal" })).resolves.toBe(false);
  });

  it("fails closed with a named denial before activation and enforces expiry", async () => {
    const h = harness(); const ref = { capabilityKind: "browser" as const, projectId: "project", goalId: "goal" };
    await expect(h.service.consumeExternalCapability({ ...ref, commandId: "command" })).rejects.toMatchObject({ name: "ExternalCapabilityDeniedError", reason: "not_activated" });
    await h.service.activateExternalCapability({ ...ref, activationId: "activation", expiresAt: new Date("2026-01-01T00:01:00Z"), repetitionScope: { kind: "bounded_time", expiresAt: new Date("2026-01-01T00:00:30Z") } }, h.actor);
    h.advance("2026-01-01T00:01:01Z");
    await expect(h.service.consumeExternalCapability({ ...ref, commandId: "command" })).rejects.toMatchObject({ reason: "expired" });
  });

  it("uses the shared repetition machinery and revocation stops the next attempt", async () => {
    const h = harness(); const ref = { capabilityKind: "deployment" as const, projectId: "project", goalId: "goal" };
    await h.service.activateExternalCapability({ ...ref, activationId: "activation", expiresAt: new Date("2026-01-02T00:00:00Z"), repetitionScope: { kind: "bounded_count", count: 1 } }, h.actor);
    await expect(h.service.consumeExternalCapability({ ...ref, commandId: "command-1" })).resolves.toMatchObject({ consumed: true, remainingCount: 0 });
    await expect(h.service.consumeExternalCapability({ ...ref, commandId: "command-2" })).rejects.toMatchObject({ reason: "repetition_exhausted" });
    await h.service.revokeExternalCapability(ref, h.actor);
    await expect(h.service.consumeExternalCapability({ ...ref, commandId: "command-3" })).rejects.toMatchObject({ reason: "revoked" });
  });
});
