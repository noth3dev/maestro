import type { ApiClient, GoalEvent, GoalResult } from "@maestro/api-client";

export interface GoalPageData {
  goal: GoalResult;
  events: GoalEvent[];
}

type GoalDataApi = Pick<ApiClient, "getGoal" | "listEvents">;

/** Pure read-model assembly, independent of how `api` reaches the control plane (direct fetch in tests, IPC-bridged in the renderer). */
export async function loadGoalPageData(api: GoalDataApi, query: { projectId: string; goalId: string }): Promise<GoalPageData> {
  const [goal, page] = await Promise.all([
    api.getGoal(query.goalId, { projectId: query.projectId }),
    api.listEvents({ projectId: query.projectId, after: "0" }),
  ]);
  return { goal, events: page.events.filter((event) => event.goalId === goal.goalId) };
}
