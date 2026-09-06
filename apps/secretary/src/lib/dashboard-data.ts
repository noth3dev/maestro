import type { GoalResult, GoalBudgetSummary } from "@maestro/api-client";
import type { Certification } from "@maestro/contracts";

/**
 * The minimal shape this module needs from a loaded Goal detail. Deliberately independent of
 * `useGoalDetail.ts` (a renderer/JSX-side hook) so this file can stay in the plain, DOM-free
 * `src/lib` build project alongside `goal-data.ts`; `useGoalDetail`'s richer `GoalDetail` type is
 * a structural superset and satisfies this interface directly.
 */
export interface DashboardGoalDetail {
  goal: GoalResult;
  budget: GoalBudgetSummary;
  certifications: Certification[];
}

export interface DashboardSummary {
  totalGoals: number;
  selectedGoal?: {
    goalId: string;
    state: GoalResult["state"];
    version: number;
    certifiedCount: number;
    budgetCents: number;
    reservedCents: number;
    costCents: number;
  };
}

/**
 * Pure view-model assembly for the Dashboard screen. Never fabricates a number: every field is
 * either a direct real value from the durable Goal list / selected Goal detail, or omitted
 * entirely (`selectedGoal` is `undefined`) when no Goal is loaded yet.
 */
export function summarizeDashboard(goals: GoalResult[] | undefined, detail: DashboardGoalDetail | undefined): DashboardSummary {
  const totalGoals = goals?.length ?? 0;
  if (detail === undefined) return { totalGoals };
  return {
    totalGoals,
    selectedGoal: {
      goalId: detail.goal.goalId,
      state: detail.goal.state,
      version: detail.goal.version,
      certifiedCount: detail.certifications.length,
      budgetCents: detail.budget.budgetCents,
      reservedCents: detail.budget.reservedCents,
      costCents: detail.budget.costCents,
    },
  };
}
