import { describe, expect, it } from "vitest";
import { AuthorizedEffectExecutor, evaluateAction, type ActionRequest, type AuthorityRecord, type AuthorityRepository } from "./authority.js";

const request: ActionRequest = {
  commandId: "command-1",
  projectId: "project-1",
  actorId: "actor-1",
  goalId: "goal-1",
  action: "git.remote.push",
  target: "origin/main",
  policyVersion: 1,
  budgetEffectCents: 0,
  controlEpoch: "1",
};

const exactApproval: AuthorityRecord = {
  recordId: "approval-1",
  kind: "approval",
  commandId: "command-1",
  projectId: "project-1",
  actorId: "actor-1",
  goalId: "goal-1",
  action: "git.remote.push",
  target: "origin/main",
  policyVersion: 1,
  budgetEffectCents: 0,
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

  it("classifies browser commands as ordinary scoped effects", () => {
    const browser: ActionRequest = { ...request, commandId: "browser-1", action: "browser.click", target: "#submit" };
    const grant: AuthorityRecord = { ...exactApproval, recordId: "browser-grant", kind: "grant", commandId: null, action: browser.action, target: browser.target };
    expect(evaluateAction(browser, [grant], now)).toMatchObject({ effect: "allow", classification: "ordinary", reason: "exact_grant" });
  });

  it("denies actions forbidden by policy", () => {
    expect(evaluateAction({ ...request, action: "system.policy.bypass" }, [exactApproval], now)).toMatchObject({ effect: "deny", reason: "forbidden", classification: "forbidden" });
  });
});


  it("rejects a grant scoped to another project", () => {
    const ordinary: ActionRequest = { ...request, action: "project.file.edit", target: "/repo" };
    const grant: AuthorityRecord = { ...exactApproval, recordId: "grant-project", kind: "grant", commandId: null, action: ordinary.action, target: ordinary.target };
    expect(evaluateAction(ordinary, [{ ...grant, projectId: "project-2" }], now)).toMatchObject({ effect: "deny", reason: "no_grant" });
  });

  it("rejects a grant or approval with an altered budget effect", () => {
    const ordinary: ActionRequest = { ...request, action: "project.file.edit", target: "/repo", budgetEffectCents: 25 };
    const grant: AuthorityRecord = { ...exactApproval, recordId: "grant-budget", kind: "grant", commandId: null, action: ordinary.action, target: ordinary.target, budgetEffectCents: 24 };
    expect(evaluateAction(ordinary, [grant], now)).toMatchObject({ effect: "deny", reason: "no_grant" });
    expect(evaluateAction({ ...request, budgetEffectCents: 1 }, [exactApproval], now)).toMatchObject({ effect: "require_approval", reason: "critical_action" });
  });


describe("AuthorizedEffectExecutor effect claims", () => {
  it("does not invoke a claimed durable command twice", async () => {
    let claimed = false;
    let calls = 0;
    const repository: AuthorityRepository = {
      load: async () => [exactApproval],
      appendDecision: async () => {},
      recheckControl: async () => ({ effect: "allow" }),
      claimEffect: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
    };
    const executor = new AuthorizedEffectExecutor(repository, () => now);
    await expect(executor.execute(request, async () => { calls += 1; })).resolves.toMatchObject({ effect: "allow" });
    await expect(executor.execute(request, async () => { calls += 1; })).resolves.toMatchObject({ effect: "allow", reason: "already_executed" });
    expect(calls).toBe(1);
  });
});

describe("AuthorizedEffectExecutor control recheck", () => {
  it("does not call the effect when emergency stop latches after the audit", async () => {
    const ordinary: ActionRequest = {
      ...request,
      commandId: "edit-1",
      action: "project.file.edit",
      target: "/repo",
    };
    const grant: AuthorityRecord = {
      ...exactApproval,
      recordId: "grant-1",
      kind: "grant",
      commandId: null,
      action: ordinary.action,
      target: ordinary.target,
    };
    const repository: AuthorityRepository = {
      load: async () => [grant],
      appendDecision: async () => {},
      recheckControl: async () => ({ effect: "deny", reason: "emergency_stop" }),
    };
    let calls = 0;

    await expect(new AuthorizedEffectExecutor(repository, () => now).execute(ordinary, async () => {
      calls += 1;
    })).resolves.toMatchObject({ effect: "deny", reason: "emergency_stop" });
    expect(calls).toBe(0);
  });

  it("does not call the effect when its control epoch is stale", async () => {
    const ordinary: ActionRequest = {
      ...request,
      commandId: "edit-1",
      action: "project.file.edit",
      target: "/repo",
      controlEpoch: "4",
    };
    const grant: AuthorityRecord = {
      ...exactApproval,
      recordId: "grant-1",
      kind: "grant",
      commandId: null,
      action: ordinary.action,
      target: ordinary.target,
    };
    const repository: AuthorityRepository = {
      load: async () => [grant],
      appendDecision: async () => {},
      recheckControl: async () => ({ effect: "deny", reason: "stale_control_epoch" }),
    };
    let calls = 0;

    await expect(new AuthorizedEffectExecutor(repository, () => now).execute(ordinary, async () => {
      calls += 1;
    })).resolves.toMatchObject({ effect: "deny", reason: "stale_control_epoch" });
    expect(calls).toBe(0);
  });

  it.each(["pause_requested", "paused", "stopping", "stopped"] as const)(
    "does not call the effect when the Goal control reason is %s",
    async (reason) => {
      const ordinary: ActionRequest = {
        ...request,
        commandId: "edit-1",
        action: "project.file.edit",
        target: "/repo",
      };
      const grant: AuthorityRecord = {
        ...exactApproval,
        recordId: "grant-1",
        kind: "grant",
        commandId: null,
        action: ordinary.action,
        target: ordinary.target,
      };
      const repository: AuthorityRepository = {
        load: async () => [grant],
        appendDecision: async () => {},
        recheckControl: async () => ({ effect: "deny", reason }),
      };
      let calls = 0;

      await expect(new AuthorizedEffectExecutor(repository, () => now).execute(ordinary, async () => {
        calls += 1;
      })).resolves.toMatchObject({ effect: "deny", reason });
      expect(calls).toBe(0);
    },
  );
});
