import { describe, expect, it } from "vitest";
import { renderApprovalDialog } from "./approval-dialog.js";

describe("approval dialog", () => {
  it("renders exact action, target, goal, effect, and expiry", () => {
    expect(renderApprovalDialog({ action: "goal.emergency-stop", target: "goal-1", goalId: "goal-1", effect: "Stop active work", expiresAt: "2030-01-01T00:00:00.000Z" }, 80)).toEqual([
      "Approval required",
      "Action: goal.emergency-stop",
      "Target: goal-1",
      "Goal: goal-1",
      "Effect: Stop active work",
      "Expires: 2030-01-01T00:00:00.000Z",
      "Press y to approve · n to cancel",
    ]);
  });
});
