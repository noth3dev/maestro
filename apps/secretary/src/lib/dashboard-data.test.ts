import { describe, expect, it } from "vitest";
import type { GoalResult } from "@maestro/api-client";
import { summarizeDashboard, type DashboardGoalDetail } from "./dashboard-data.js";

const goalId = "22222222-2222-4222-8222-222222222222";
const projectId = "11111111-1111-4111-8111-111111111111";

const goals: GoalResult[] = [
  { goalId, projectId, state: "active", version: 3 },
  { goalId: "33333333-3333-4333-8333-333333333333", projectId, state: "draft", version: 0 },
];

const detail: DashboardGoalDetail = {
  goal: { goalId, projectId, state: "active", version: 3 },
  budget: { goalId, projectId, budgetCents: 30000, reservedCents: 5000, costCents: 1200 },
  certifications: [{ certificationId: "cert-1" } as unknown as DashboardGoalDetail["certifications"][number]],
};

describe("summarizeDashboard", () => {
  it("reports only the real Goal count when no Goal is selected yet", () => {
    expect(summarizeDashboard(undefined, undefined)).toEqual({ totalGoals: 0 });
    expect(summarizeDashboard(goals, undefined)).toEqual({ totalGoals: 2 });
  });

  it("reports the exact durable state, version, budget, and certification count for the selected Goal", () => {
    expect(summarizeDashboard(goals, detail)).toEqual({
      totalGoals: 2,
      selectedGoal: {
        goalId,
        state: "active",
        version: 3,
        certifiedCount: 1,
        budgetCents: 30000,
        reservedCents: 5000,
        costCents: 1200,
      },
    });
  });

  it("never fabricates a certification or budget number beyond what was loaded", () => {
    const emptyDetail: DashboardGoalDetail = { ...detail, certifications: [] };
    expect(summarizeDashboard(goals, emptyDetail).selectedGoal?.certifiedCount).toBe(0);
  });
});
