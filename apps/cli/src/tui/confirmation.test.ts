import { describe, expect, it, vi } from "vitest";
import { confirmCriticalAction, type CriticalActionSummary } from "./confirmation.js";

const summary: CriticalActionSummary = { action: "goal.emergency-stop", target: "goal-1", goalId: "goal-1", effect: "Stop active work", expiresAt: "2030-01-01T00:00:00.000Z" };

describe("critical action confirmation", () => {
  it("shows the exact summary and returns approval", async () => {
    const prompt = vi.fn().mockResolvedValue("approved" as const);
    await expect(confirmCriticalAction(summary, prompt)).resolves.toBe("approved");
    expect(prompt).toHaveBeenCalledWith(summary);
  });

  it("returns cancellation without invoking a client", async () => {
    await expect(confirmCriticalAction(summary, vi.fn().mockResolvedValue("cancelled" as const))).resolves.toBe("cancelled");
  });
});
