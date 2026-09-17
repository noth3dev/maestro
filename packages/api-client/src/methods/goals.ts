import {
  CreateGoalInputSchema,
  GoalQuerySchema,
  GoalListSchema,
  GoalBudgetSummarySchema,
  GoalResultSchema,
  TransitionGoalInputSchema,
  UuidSchema,
} from "@maestro/contracts";
import type { ApiClient } from "../client.js";
import type { MethodContext } from "../context.js";

export function createGoalsMethods(
  ctx: MethodContext,
): Pick<
  ApiClient,
  | "createGoal"
  | "listGoals"
  | "getGoal"
  | "getBudgetSummary"
  | "transitionGoal"
  | "pauseGoal"
  | "stopGoal"
  | "resumeGoal"
  | "emergencyStopGoal"
> {
  const { request, headers, controlGoal } = ctx;
  return {
    createGoal(input, commandId) {
      return request(
        "v1/goals",
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(CreateGoalInputSchema.parse(input)),
        },
        GoalResultSchema,
      );
    },

    listGoals(projectId) {
      const parsedProjectId = UuidSchema.parse(projectId);
      return request(`v1/goals?${new URLSearchParams({ projectId: parsedProjectId })}`, { headers }, GoalListSchema);
    },

    getGoal(goalId, query) {
      const parsedGoalId = UuidSchema.parse(goalId);
      const parsedQuery = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(parsedGoalId)}?${new URLSearchParams({ projectId: parsedQuery.projectId })}`,
        { headers },
        GoalResultSchema,
      );
    },
    getBudgetSummary(goalId, query) {
      const parsed = GoalQuerySchema.parse(query);
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/budget?${new URLSearchParams({ projectId: parsed.projectId })}`,
        { headers },
        GoalBudgetSummarySchema,
      );
    },
    transitionGoal(goalId, input, commandId) {
      return request(
        `v1/goals/${encodeURIComponent(UuidSchema.parse(goalId))}/transitions`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": UuidSchema.parse(commandId) },
          body: JSON.stringify(TransitionGoalInputSchema.parse(input)),
        },
        GoalResultSchema,
      );
    },
    pauseGoal(goalId, input, commandId) {
      return controlGoal(goalId, input, commandId, "pause");
    },
    stopGoal(goalId, input, commandId) {
      return controlGoal(goalId, input, commandId, "stop");
    },
    resumeGoal(goalId, input, commandId) {
      return controlGoal(goalId, input, commandId, "resume");
    },
    emergencyStopGoal(goalId, input, commandId) {
      return controlGoal(goalId, input, commandId, "emergency-stop");
    },
  };
}
