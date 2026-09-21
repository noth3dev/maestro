import type { ApiClient, GoalList, GoalResult } from "@maestro/api-client";

export type GoalOperationsApi = Pick<ApiClient, "listGoals">;

export async function loadGoalsAfterLaunch(
  api: GoalOperationsApi,
  input: { projectId: string },
): Promise<GoalList> {
  return api.listGoals(input.projectId);
}

export function selectedGoalIdAfterRefresh(
  selectedGoalId: string | undefined,
  goals: readonly GoalResult[],
): string | undefined {
  if (selectedGoalId !== undefined && goals.some((goal) => goal.goalId === selectedGoalId)) return selectedGoalId;
  return goals[0]?.goalId;
}
