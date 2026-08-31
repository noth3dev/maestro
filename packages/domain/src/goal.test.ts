import { describe, expect, it } from "vitest";
import { InvalidGoalTransitionError, transitionGoal, type GoalState } from "./goal.js";

describe("transitionGoal", () => {
  it("allows a draft goal to become ready for confirmation", () => {
    expect(transitionGoal("draft", "ready_for_confirmation")).toBe("ready_for_confirmation");
  });

  it("rejects a terminal goal returning to active with a typed reason", () => {
    try {
      transitionGoal("succeeded", "active");
      throw new Error("Expected transition to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidGoalTransitionError);
      expect(error).toMatchObject({ from: "succeeded", to: "active" });
      expect((error as Error).message).toBe(
        "Invalid Goal transition: succeeded -> active",
      );
    }
  });

  it("matches the complete allowed transition matrix", () => {
    const states: GoalState[] = [
      "draft", "ready_for_confirmation", "launched", "active", "pausing",
      "paused", "resuming", "stopping", "stopped", "blocked",
      "certifying", "succeeded", "failed", "recovering",
    ];
    const allowed = new Set([
      "draft:ready_for_confirmation", "draft:recovering",
      "ready_for_confirmation:draft", "ready_for_confirmation:launched",
      "ready_for_confirmation:recovering",
      "launched:active", "launched:recovering",
      "active:pausing", "active:stopping", "active:blocked",
      "active:certifying", "active:recovering",
      "pausing:paused", "pausing:blocked", "pausing:recovering",
      "paused:resuming", "paused:stopping", "paused:blocked",
      "paused:recovering",
      "resuming:active", "resuming:blocked", "resuming:recovering",
      "stopping:stopped", "stopping:blocked", "stopping:recovering",
      "blocked:active", "blocked:stopped", "blocked:recovering",
      "certifying:succeeded", "certifying:failed", "certifying:blocked",
      "certifying:recovering",
      "recovering:active", "recovering:paused", "recovering:blocked",
      "recovering:stopped",
    ]);

    for (const from of states) {
      for (const to of states) {
        const key = `${from}:${to}`;
        if (allowed.has(key)) {
          expect(transitionGoal(from, to), key).toBe(to);
        } else {
          expect(() => transitionGoal(from, to), key).toThrow(
            InvalidGoalTransitionError,
          );
        }
      }
    }
  });

});
