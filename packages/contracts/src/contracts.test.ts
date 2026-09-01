import { describe, expect, it } from "vitest";
import {
  CreateGoalInputSchema,
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
