import { describe, expect, it } from "vitest";
import {
  CreateGoalInputSchema,
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
