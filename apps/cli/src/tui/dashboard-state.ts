import type { DashboardReadModel } from "./commands/read-commands.js";
import type { AsyncState } from "./components/shell.js";

export interface DashboardStateValues {
  goal: AsyncState<{ name: string; state: string }>;
  workers: AsyncState<number>;
  budget: AsyncState<{ spentCents: number; ceilingCents: number }>;
}

export function dashboardStateFromReadModel(dashboard: DashboardReadModel): DashboardStateValues {
  return {
    goal:
      dashboard.selectedGoal === undefined
        ? { kind: "empty" }
        : { kind: "value", value: { name: dashboard.selectedGoal.goalId, state: dashboard.selectedGoal.state } },
    workers: dashboard.workerCount === undefined ? { kind: "empty" } : { kind: "value", value: dashboard.workerCount },
    budget:
      dashboard.budget === undefined
        ? { kind: "empty" }
        : { kind: "value", value: { spentCents: dashboard.budget.costCents, ceilingCents: dashboard.budget.budgetCents } },
  };
}

export function dashboardErrorState(message: string): DashboardStateValues {
  return {
    goal: { kind: "error", message },
    workers: { kind: "error", message },
    budget: { kind: "error", message },
  };
}
