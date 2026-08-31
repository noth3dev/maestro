import { describe, expect, it } from "vitest";
import { transitionGoal, type GoalState } from "./goal.js";

describe("transitionGoal", () => {
  it("allows a draft goal to become ready for confirmation", () => {
    expect(transitionGoal("draft", "ready_for_confirmation")).toBe("ready_for_confirmation");
  });

  it("rejects a terminal goal returning to active", () => {
    expect(() => transitionGoal("succeeded", "active")).toThrow(
      "Invalid Goal transition: succeeded -> active",
    );
  });

  it.each<[GoalState, GoalState]>([
    ["active", "pausing"],
    ["pausing", "paused"],
    ["paused", "resuming"],
    ["resuming", "active"],
    ["active", "certifying"],
    ["certifying", "succeeded"],
  ])("allows %s -> %s", (from, to) => {
    expect(transitionGoal(from, to)).toBe(to);
  });
});
