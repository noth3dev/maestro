import { createApiClient, type ApiClient } from "@maestro/api-client";
import type { ConnectionConfig } from "./store.js";

/** Only these ApiClient methods are reachable from the renderer. Every write here already exists as a real, tested control-plane route. */
export const exposedApiMethods = [
  "listGoals", "getGoal", "createGoal", "listProjects", "getOrganization", "provisionProjectAccess", "transitionGoal",
  "getSettings", "updateSettingsPreferences", "updateSettingsModelPool", "updateSettingsAuthorityDefaults", "getRouterCatalog", "validateRouterConfig", "replaceRouterConfig", "listProviderConnections", "loginProvider", "logoutProvider", "startAccountLogin", "accountLoginStatus", "cancelAccountLogin", "logoutAccount", "getBudgetSummary", "getBillingSummary", "getChannel", "postChannelMessage", "getProjection", "listEvents", "streamEvents",
  "createTaskContract", "getTaskContract", "updateTaskContract", "selectOvertureRoles", "confirmTaskContract", "launchTaskContract",
  "pauseGoal", "resumeGoal", "stopGoal", "emergencyStopGoal",
  "requestCriticalAction", "approveAndRunCriticalAction", "selectFullAccessMode", "denyCriticalAction", "listInbox",
  "listModels", "createConversation", "getConversation", "sendConversationTurn", "cancelConversation", "listConversationEvents",
  "activateHead", "createCouncil", "getCouncil", "submitCouncilBrief", "revealCouncil", "decideCouncil",
  "createDepartmentPlan", "getDepartmentPlan", "createMissionBundle", "getMissionBundle", "spawnWorker", "getWorker", "observeWorker", "sendWorkerMessage", "cancelWorker",
  "createGoalIntegrationBranch", "createDepartmentBranch", "createWorkerWorktree", "freezeGoalIntegrationRevision", "advanceWorkerIntegration",
  "captureEvidence", "getEvidenceDump",
  "acceptWorker", "certifyWorker", "certifyConditionalWorker",
  "scanMetronome", "raiseMetronomeChallenge", "requestMetronomeCorrection", "requestMetronomeSafePause", "resolveMetronomeChallenge", "runEncoreReview",
  "generateConcertmasterReport",
  "getPersona", "proposePersona", "editPersonaCandidate", "listCertifications", "getEvidenceBundle", "listMetronomeChallenges", "listEncoreCouncilRounds", "getConcertmasterReport", "getGitIntegrationState", "listWorkersForGoal", "listImprovementDigestsForGoal", "getArrangements",
] as const satisfies readonly (keyof ApiClient)[];
export type ExposedApiMethod = (typeof exposedApiMethods)[number];

export function createBridgedApi(config: ConnectionConfig): ApiClient {
  return createApiClient({ baseUrl: config.apiUrl, token: config.token });
}

export function isExposedMethod(method: string): method is ExposedApiMethod {
  return (exposedApiMethods as readonly string[]).includes(method);
}
