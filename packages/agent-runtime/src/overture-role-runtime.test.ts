import { describe, expect, it } from "vitest";
import { createOvertureRoleRuntimePolicy } from "@maestro/domain";
import { createOvertureRoleRuntime } from "./overture-role-runtime.js";

const policy = createOvertureRoleRuntimePolicy({
  roleId: "security-evaluator",
  projectId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  conversationId: "33333333-3333-4333-8333-333333333333",
});

describe("Overture role runtime", () => {
  it("creates a role-scoped grant without execution authority", () => {
    const runtime = createOvertureRoleRuntime({
      gateway: {} as never,
      binding: { provider: { provider: "openai", id: "gpt-5" }, account: { accountRef: "account" } } as never,
      policy,
      tools: {} as never,
    });
    expect(runtime.grant.allowedTools).toEqual(policy.allowedTools);
    expect(runtime.grant.allowedTools).not.toEqual(
      expect.arrayContaining(["worker:spawn", "mission-bundle:create", "task-contract:create", "git:write", "critical-action:approve"]),
    );
    expect(runtime.grant.modelPolicy).toEqual(["openai/gpt-5"]);
    expect(runtime.grant.remaining.outputTokens).toBe(policy.outputTokenBudget);
    expect(runtime.runtime).toBeDefined();
  });
});
