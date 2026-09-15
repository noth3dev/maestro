import { contextBridge, ipcRenderer } from "electron";

// ponytail: duplicated from electron/apiBridge.ts's `exposedApiMethods` rather than imported —
// contextBridge.exposeInMainWorld can only clone a plain object of functions (a Proxy fails with
// "An object could not be cloned"), and importing an ESM sibling into this CommonJS preload isn't
// reliable across Electron's bundled Node version. Keep this list in sync with apiBridge.ts.
type RendererEventStreamMessage = { kind: "event" | "end" | "error"; event?: unknown; message?: string };
type RendererEventListener = (message: RendererEventStreamMessage) => void;
const eventChannels = { start: "maestro:events:start", message: "maestro:events:message", stop: "maestro:events:stop" } as const;

/** Exposes callbacks, not an AsyncIterable, because Symbols cannot cross contextBridge cloning. */
function subscribeToEventStream(query: { projectId: string; after: string }, listener: RendererEventListener): () => void {
  const streamId = globalThis.crypto.randomUUID();
  let stopped = false;
  const cleanup = (): void => {
    ipcRenderer.removeListener(eventChannels.message, onMessage);
  };
  const onMessage = (...args: unknown[]): void => {
    const streamIdIndex = typeof args[0] === "string" ? 0 : 1;
    if (args[streamIdIndex] !== streamId) return;
    const message = args[streamIdIndex + 1] as RendererEventStreamMessage | undefined;
    if (message === undefined) return;
    listener(message);
    if (message.kind === "end" || message.kind === "error") cleanup();
  };
  ipcRenderer.on(eventChannels.message, onMessage);
  ipcRenderer.send(eventChannels.start, streamId, query);
  return () => {
    if (stopped) return;
    stopped = true;
    cleanup();
    ipcRenderer.send(eventChannels.stop, streamId);
  };
}

const exposedApiMethods = [
  "listGoals", "getGoal", "getSettings", "updateSettingsPreferences", "updateSettingsModelPool", "updateSettingsAuthorityDefaults", "listProviderConnections", "loginProvider", "logoutProvider", "getBudgetSummary", "getBillingSummary", "getArrangements", "getChannel", "postChannelMessage", "getProjection", "listEvents", "streamEvents",
  "createTaskContract", "getTaskContract", "updateTaskContract", "selectOvertureRoles", "confirmTaskContract", "launchTaskContract",
  "pauseGoal", "resumeGoal", "stopGoal", "emergencyStopGoal",
  "requestCriticalAction", "approveAndRunCriticalAction", "selectFullAccessMode", "denyCriticalAction", "listInbox",
  "listModels", "createConversation", "sendConversationTurn",
  "createCouncil", "submitCouncilBrief", "revealCouncil", "decideCouncil",
  "createDepartmentPlan", "createMissionBundle", "spawnWorker", "cancelWorker",
  "createGoalIntegrationBranch", "createDepartmentBranch", "createWorkerWorktree",
  "acceptWorker", "certifyWorker", "certifyConditionalWorker",
  "requestMetronomeCorrection", "requestMetronomeSafePause",
  "getPersona", "proposePersona", "editPersonaCandidate",
  "listCertifications", "getEvidenceBundle", "listMetronomeChallenges", "listEncoreCouncilRounds", "getConcertmasterReport", "getGitIntegrationState", "listWorkersForGoal", "listImprovementDigestsForGoal",
] as const;

const api = Object.fromEntries(
  exposedApiMethods
    .filter((method) => method !== "streamEvents")
    .map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke("maestro:api", method, args)]),
) as Record<string, (...args: unknown[]) => unknown>;


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
  events: {
    subscribe: subscribeToEventStream,
  },
});
