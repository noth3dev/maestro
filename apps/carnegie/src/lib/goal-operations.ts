import type { ApiClient, GoalList, GoalResult, StartGoalOrchestrationStatus } from "@maestro/api-client";

export type GoalOperationsApi = Pick<ApiClient, "listGoals">;
export type GoalRefreshApi = { refreshGoals: () => Promise<GoalList | undefined> };
export type GoalOrchestrationStatusApi = Pick<ApiClient, "getGoalOrchestrationStatus">;

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

export async function loadGoalOrchestrationStatuses(api: GoalOrchestrationStatusApi, input: { readonly projectId: string }, goals: readonly GoalResult[]): Promise<Readonly<Record<string, StartGoalOrchestrationStatus>>> {
  const entries = await Promise.all(goals.map(async (goal) => {
    try { return [goal.goalId, await api.getGoalOrchestrationStatus(goal.goalId, { projectId: input.projectId })] as const; }
    catch { return undefined; }
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, StartGoalOrchestrationStatus] => entry !== undefined));
}
