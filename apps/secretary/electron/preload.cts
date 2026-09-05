import { contextBridge, ipcRenderer } from "electron";

// ponytail: duplicated from electron/apiBridge.ts's `exposedApiMethods` rather than imported —
// contextBridge.exposeInMainWorld can only clone a plain object of functions (a Proxy fails with
// "An object could not be cloned"), and importing an ESM sibling into this CommonJS preload isn't
// reliable across Electron's bundled Node version. Keep this list in sync with apiBridge.ts.
const exposedApiMethods = [
  "listGoals", "getGoal", "getBudgetSummary", "listEvents",
  "createTaskContract", "getTaskContract", "updateTaskContract", "selectOvertureRoles", "confirmTaskContract", "launchTaskContract",
  "pauseGoal", "resumeGoal", "stopGoal", "emergencyStopGoal",
  "listCertifications", "listMetronomeChallenges", "listEncoreCouncilRounds", "getConcertmasterReport",
] as const;

const api = Object.fromEntries(
  exposedApiMethods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke("maestro:api", method, args)]),
);

contextBridge.exposeInMainWorld("maestro", {
  api,
  config: {
    get: () => ipcRenderer.invoke("maestro:config:get"),
    save: (config: { apiUrl: string; token: string; projectId: string }) => ipcRenderer.invoke("maestro:config:save", config),
    clear: () => ipcRenderer.invoke("maestro:config:clear"),
  },
  preferences: {
    get: () => ipcRenderer.invoke("maestro:preferences:get"),
    save: (preferences: { theme: string; locale: string }) => ipcRenderer.invoke("maestro:preferences:save", preferences),
  },
});
