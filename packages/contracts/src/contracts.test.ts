import { describe, expect, it } from "vitest";
import {
  CreateGoalInputSchema,
  CriticalActionInputSchema,
  ProjectAccessProvisionInputSchema,
  GoalStateSchema,
  StableApiErrorSchema,
  TransitionGoalInputSchema,
} from "./index.js";

const projectId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01";

describe("goal HTTP contracts", () => {
  it("accepts public create and transition inputs", () => {
    expect(CreateGoalInputSchema.parse({ projectId })).toEqual({ projectId });
    expect(TransitionGoalInputSchema.parse({ projectId, expectedVersion: 1, to: "ready_for_confirmation" })).toEqual({
      projectId, expectedVersion: 1, to: "ready_for_confirmation",
    });
  });

  it("does not expose actor, approval, or fencing fields", () => {
    expect(CreateGoalInputSchema.safeParse({ projectId, actorId: "operator" }).success).toBe(false);
    expect(TransitionGoalInputSchema.safeParse({ projectId, expectedVersion: 1, to: "active", fencingToken: "1" }).success).toBe(false);
  });

  it("rejects negative, unsafe, or oversized effect budgets", () => {
    const base = { projectId, action: "payment.spend", target: "merchant", policyVersion: 1 };
    expect(CriticalActionInputSchema.safeParse({ ...base, budgetEffectCents: -1 }).success).toBe(false);
    expect(CriticalActionInputSchema.safeParse({ ...base, budgetEffectCents: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(CriticalActionInputSchema.safeParse({ ...base, budgetEffectCents: 1_000_000_001 }).success).toBe(false);
    expect(CriticalActionInputSchema.safeParse({ ...base, budgetEffectCents: 1_000_000_000 }).success).toBe(true);
  });

  it("provides closed goal states and stable errors", () => {
    expect(GoalStateSchema.safeParse("unknown").success).toBe(false);
    expect(StableApiErrorSchema.parse({ error: { code: "version_conflict", message: "Version conflict" } })).toEqual({
      error: { code: "version_conflict", message: "Version conflict" },
    });
  });
});


describe("project access provisioning contracts", () => {
  it("requires a canonical operator/project pair and exact non-empty roles", () => {
    const input = { operatorId: projectId, projectId, roles: ["concertmaster", "head-product"] };
    expect(ProjectAccessProvisionInputSchema.parse(input)).toEqual(input);
    expect(ProjectAccessProvisionInputSchema.safeParse({ ...input, roles: [] }).success).toBe(false);
    expect(ProjectAccessProvisionInputSchema.safeParse({ ...input, roles: ["concertmaster", "concertmaster"] }).success).toBe(false);
  });

  it("rejects attempts to smuggle actor or capability fields into provisioning", () => {
    expect(ProjectAccessProvisionInputSchema.safeParse({ operatorId: projectId, projectId, roles: ["concertmaster"], actorId: projectId }).success).toBe(false);
    expect(ProjectAccessProvisionInputSchema.safeParse({ operatorId: projectId, projectId, roles: ["*"] }).success).toBe(false);
  });
});


describe("conversation streaming contracts", () => {
  it("accepts the stable unknown account-login error code", async () => {
    const { StableApiErrorSchema } = await import("./index.js");
    expect(StableApiErrorSchema.parse({ error: { code: "account_login_session_unknown", message: "Account login session is unknown" } }).error.code).toBe("account_login_session_unknown");
  });

  it("accepts durable turn delta events", async () => {
    const { ConversationEventSchema } = await import("./index.js");
    expect(ConversationEventSchema.parse({
      cursor: "3",
      eventId: projectId,
      conversationId: projectId,
      projectId,
      eventType: "turn_delta",
      payload: { turnId: projectId, text: "chunk" },
      occurredAt: "2030-01-01T00:00:00.000Z",
    }).eventType).toBe("turn_delta");
  });
});
