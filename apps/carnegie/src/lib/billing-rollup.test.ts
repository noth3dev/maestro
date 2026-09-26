import { describe, expect, it } from "vitest";
import type { BillingReadModel } from "@maestro/contracts";
import { combineBilling } from "./billing-rollup.js";

const billing = (projectId: string, days: Record<string, number>, goals: number, costCents: number): BillingReadModel => ({
  projectId, periodDays: 14,
  dailySpend: Object.entries(days).map(([date, cost]) => ({ date, costCents: cost })),
  goals: Array.from({ length: goals }, (_, index) => ({ goalId: `${projectId}-${index}`, budgetCents: 100, reservedCents: 10, costCents: costCents / goals })),
  totals: { budgetCents: 100 * goals, reservedCents: 10 * goals, costCents },
  departmentBreakdown: { available: false, reason: "n/a" },
});

describe("global billing", () => {
  it("sums daily spend and totals across projects and ranks projects by spend", () => {
    const combined = combineBilling([
      { project: { projectId: "a", name: "Home" }, billing: billing("a", { "2026-09-25": 5, "2026-09-26": 0 }, 1, 5) },
      { project: { projectId: "b", name: "Newsletter" }, billing: billing("b", { "2026-09-25": 10, "2026-09-26": 20 }, 2, 30) },
    ]);
    expect(combined.dailySpend).toEqual([{ date: "2026-09-25", costCents: 15 }, { date: "2026-09-26", costCents: 20 }]);
    expect(combined.totals).toEqual({ budgetCents: 300, reservedCents: 30, costCents: 35 });
    expect(combined.goalCount).toBe(3);
    expect(combined.projects.map((project) => project.name)).toEqual(["Newsletter", "Home"]);
  });
});
