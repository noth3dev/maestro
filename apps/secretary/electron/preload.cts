import { contextBridge, ipcRenderer } from "electron";

// ponytail: duplicated from electron/apiBridge.ts's `exposedApiMethods` rather than imported —
// contextBridge.exposeInMainWorld can only clone a plain object of functions (a Proxy fails with
// "An object could not be cloned"), and importing an ESM sibling into this CommonJS preload isn't
// reliable across Electron's bundled Node version. Keep this list in sync with apiBridge.ts.
const exposedApiMethods = [
  "listGoals", "getGoal", "getBudgetSummary", "getProjection", "listEvents",
  "createTaskContract", "getTaskContract", "updateTaskContract", "selectOvertureRoles", "confirmTaskContract", "launchTaskContract",
  "pauseGoal", "resumeGoal", "stopGoal", "emergencyStopGoal",
  "requestCriticalAction", "approveAndRunCriticalAction",
  "createCouncil", "submitCouncilBrief", "revealCouncil", "decideCouncil",
  "createDepartmentPlan", "createMissionBundle", "spawnWorker", "cancelWorker",
  "createGoalIntegrationBranch", "createDepartmentBranch", "createWorkerWorktree",
  "acceptWorker", "certifyWorker", "certifyConditionalWorker",
  "requestMetronomeCorrection", "requestMetronomeSafePause",
  "listCertifications", "getEvidenceBundle", "listMetronomeChallenges", "listEncoreCouncilRounds", "getConcertmasterReport", "getGitIntegrationState", "listWorkersForGoal", "listImprovementDigestsForGoal",
] as const;

const api = Object.fromEntries(
  exposedApiMethods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke("carnegie:api", method, args)]),
);

contextBridge.exposeInMainWorld("carnegie", {
  api,
  config: {
    get: () => ipcRenderer.invoke("carnegie:config:get"),
    save: (config: { apiUrl: string; token: string; projectId: string }) => ipcRenderer.invoke("carnegie:config:save", config),
    clear: () => ipcRenderer.invoke("carnegie:config:clear"),
  },
  preferences: {
    get: () => ipcRenderer.invoke("carnegie:preferences:get"),
    save: (preferences: { theme: string; locale: string }) => ipcRenderer.invoke("carnegie:preferences:save", preferences),
  },
});
