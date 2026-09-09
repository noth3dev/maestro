import { describe, expect, it, vi } from "vitest";
import { APPROVAL_DIALOG_SCOPE_OPTIONS, confirmCriticalAction, nextApprovalDialogScope, type CriticalActionSummary } from "./confirmation.js";

const summary: CriticalActionSummary = { action: "goal.emergency-stop", target: "goal-1", goalId: "goal-1", effect: "Stop active work", expiresAt: "2030-01-01T00:00:00.000Z" };

describe("critical action confirmation", () => {
  it("shows the exact summary and returns approval", async () => {
    const prompt = vi.fn().mockResolvedValue("approved" as const);
    await expect(confirmCriticalAction(summary, prompt)).resolves.toBe("approved");
    expect(prompt).toHaveBeenCalledWith(summary);
  });

  it("accepts an approval result carrying the selected scope for durable adapters", async () => {
    const approval = { decision: "approved" as const, repetitionScope: "session" as const };
    await expect(confirmCriticalAction(summary, vi.fn().mockResolvedValue(approval))).resolves.toEqual(approval);
  });

  it("cycles only through the selectable once, bounded-count, and session scopes", () => {
    expect(APPROVAL_DIALOG_SCOPE_OPTIONS).toEqual(["once", "bounded_count", "session"]);
    expect(nextApprovalDialogScope("once", 1)).toBe("bounded_count");
    expect(nextApprovalDialogScope("session", 1)).toBe("once");
  });

  it("returns cancellation without invoking a client", async () => {
    await expect(confirmCriticalAction(summary, vi.fn().mockResolvedValue("cancelled" as const))).resolves.toBe("cancelled");
  });
});
