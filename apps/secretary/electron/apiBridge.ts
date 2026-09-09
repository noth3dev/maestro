import { createApiClient, type ApiClient } from "@maestro/api-client";
import type { ConnectionConfig } from "./store.js";

/** Only these ApiClient methods are reachable from the renderer. Every write here already exists as a real, tested control-plane route. */
export const exposedApiMethods = [
  "listGoals", "getGoal", "getBudgetSummary", "listEvents",
  "createTaskContract", "getTaskContract", "updateTaskContract", "selectOvertureRoles", "confirmTaskContract", "launchTaskContract",
  "pauseGoal", "resumeGoal", "stopGoal", "emergencyStopGoal",
  "requestCriticalAction", "approveAndRunCriticalAction",
  "createCouncil", "submitCouncilBrief", "revealCouncil", "decideCouncil",
  "createDepartmentPlan", "createMissionBundle", "spawnWorker", "cancelWorker",
  "createGoalIntegrationBranch", "createDepartmentBranch", "createWorkerWorktree",
  "acceptWorker", "certifyWorker", "certifyConditionalWorker",
  "requestMetronomeCorrection", "requestMetronomeSafePause",
  "listCertifications", "listMetronomeChallenges", "listEncoreCouncilRounds", "getConcertmasterReport", "getGitIntegrationState", "listWorkersForGoal", "listImprovementDigestsForGoal",
] as const satisfies readonly (keyof ApiClient)[];
export type ExposedApiMethod = (typeof exposedApiMethods)[number];

export function createBridgedApi(config: ConnectionConfig): ApiClient {
  return createApiClient({ baseUrl: config.apiUrl, token: config.token });
}

export function isExposedMethod(method: string): method is ExposedApiMethod {
  return (exposedApiMethods as readonly string[]).includes(method);
}
