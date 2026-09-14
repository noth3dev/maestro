import type { GoalResult } from "@maestro/api-client";
import type { GoalControlInput } from "@maestro/contracts";

export type GoalControlAction = "pause" | "resume" | "stop" | "emergency-stop";

/** The minimal API surface this module needs, matching exactly what `electron/apiBridge.ts` exposes. */
export interface GoalControlApi {
  pauseGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  resumeGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  stopGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
  emergencyStopGoal(goalId: string, input: GoalControlInput, commandId: string): Promise<GoalResult>;
}

export interface GoalControlRequest {
  goalId: string;
  projectId: string;
  action: GoalControlAction;
  expectedVersion: number;
}

/**
 * Runs a durable Goal lifecycle control through the already-authenticated Electron API bridge.
 * The caller supplies the Goal's current durable version so a stale UI cannot silently clobber a
 * concurrent change underneath it; the control plane itself is the final authority and rejects a
 * stale `expectedVersion`, so this function never masks that rejection.
 */
export function runGoalControlAction(
  api: GoalControlApi,
  request: GoalControlRequest,
  commandId: string = crypto.randomUUID(),
): Promise<GoalResult> {
  const input: GoalControlInput = { projectId: request.projectId, expectedVersion: request.expectedVersion };
  switch (request.action) {
    case "pause":
      return api.pauseGoal(request.goalId, input, commandId);
    case "resume":
      return api.resumeGoal(request.goalId, input, commandId);
    case "stop":
      return api.stopGoal(request.goalId, input, commandId);
    case "emergency-stop":
      return api.emergencyStopGoal(request.goalId, input, commandId);
  }
}
