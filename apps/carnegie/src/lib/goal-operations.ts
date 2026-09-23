import type { ApiClient, GoalList, GoalResult } from "@maestro/api-client";

export type GoalOperationsApi = Pick<ApiClient, "listGoals">;
export type GoalRefreshApi = { refreshGoals: () => Promise<GoalList | undefined> };

export async function loadGoalsAfterLaunch(
  api: GoalOperationsApi,
  input: { projectId: string },
): Promise<GoalList> {
  return api.listGoals(input.projectId);
}

export async function selectGoalAfterLaunch(
  api: GoalRefreshApi,
  input: { goalId: string },
  selectGoal: (goalId: string) => void,
): Promise<boolean> {
  const page = await api.refreshGoals();
  if (page === undefined || !page.goals.some((goal) => goal.goalId === input.goalId)) return false;
  selectGoal(input.goalId);
  return true;
}

export function selectedGoalIdAfterRefresh(
  selectedGoalId: string | undefined,
  goals: readonly GoalResult[],
): string | undefined {
  if (selectedGoalId !== undefined && goals.some((goal) => goal.goalId === selectedGoalId)) return selectedGoalId;
  return goals[0]?.goalId;
}
