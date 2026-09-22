import { contextBridge, ipcRenderer } from "electron";

// ponytail: duplicated from electron/apiBridge.ts's `exposedApiMethods` rather than imported —
// contextBridge.exposeInMainWorld can only clone a plain object of functions (a Proxy fails with
// "An object could not be cloned"), and importing an ESM sibling into this CommonJS preload isn't
// reliable across Electron's bundled Node version. Keep this list in sync with apiBridge.ts.
type RendererEventStreamMessage = { kind: "connected" | "event" | "end" | "error"; event?: unknown; message?: string };
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
  "listGoals", "getGoal", "createGoal", "listProjects", "getOrganization", "provisionProjectAccess", "transitionGoal",
  "getSettings", "updateSettingsPreferences", "updateSettingsModelPool", "updateSettingsAuthorityDefaults", "getRouterCatalog", "validateRouterConfig", "replaceRouterConfig", "listProviderConnections", "loginProvider", "logoutProvider", "startAccountLogin", "accountLoginStatus", "cancelAccountLogin", "logoutAccount", "getBudgetSummary", "getBillingSummary", "getArrangements", "getChannel", "postChannelMessage", "getProjection", "listEvents", "streamEvents",
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
  "getPersona", "proposePersona", "editPersonaCandidate",
  "listCertifications", "getEvidenceBundle", "listMetronomeChallenges", "listEncoreCouncilRounds", "getConcertmasterReport", "getGitIntegrationState", "listWorkersForGoal", "listImprovementDigestsForGoal",
] as const;

type SerializedBridgeError =
  | { readonly kind: "api-error"; readonly status: number; readonly code: string; readonly message: string; readonly detail?: string }
  | { readonly kind: "error"; readonly message: string };
type ApiBridgeResponse =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: SerializedBridgeError };

function isApiBridgeResponse(value: unknown): value is ApiBridgeResponse {
  return typeof value === "object" && value !== null && "ok" in value && typeof (value as { ok?: unknown }).ok === "boolean";
}

function restoreBridgeError(error: SerializedBridgeError): Error {
  const restored = new Error(error.message);
  if (error.kind === "api-error") {
    Object.assign(restored, { name: "ApiError", status: error.status, code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) });
  }
  return restored;
}

async function invokeApi(method: string, args: unknown[]): Promise<unknown> {
  const response = await ipcRenderer.invoke("maestro:api", method, args) as unknown;
  if (!isApiBridgeResponse(response)) return response;
  if (response.ok) return response.value;
  throw restoreBridgeError(response.error);
}

const api = Object.fromEntries(
  exposedApiMethods
    .filter((method) => method !== "streamEvents")
    .map((method) => [method, (...args: unknown[]) => invokeApi(method, args)]),
) as Record<string, (...args: unknown[]) => unknown>;


contextBridge.exposeInMainWorld("maestro", {
  api,
  config: {
    get: () => ipcRenderer.invoke("maestro:config:get"),
    error: () => ipcRenderer.invoke("maestro:config:error"),
    save: (config: { apiUrl: string; token: string; projectId: string }) => ipcRenderer.invoke("maestro:config:save", config),
    clear: () => ipcRenderer.invoke("maestro:config:clear"),
  },
  bootstrap: {
    status: () => ipcRenderer.invoke("maestro:bootstrap:status"),
    onStatus: (listener: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(status);
      ipcRenderer.on("maestro:bootstrap-status", handler);
      return () => ipcRenderer.removeListener("maestro:bootstrap-status", handler);
    },
  },
  external: {
    openProviderAuth: (url: string) => ipcRenderer.invoke("maestro:provider-auth:open", url),
  },
  preferences: {
    get: () => ipcRenderer.invoke("maestro:preferences:get"),
    save: (preferences: { theme: string; locale: string }) => ipcRenderer.invoke("maestro:preferences:save", preferences),
  },
  windowControls: {
    minimize: () => { ipcRenderer.send("maestro:window:minimize"); },
    toggleMaximize: () => ipcRenderer.invoke("maestro:window:toggle-maximize"),
    isMaximized: () => ipcRenderer.invoke("maestro:window:is-maximized"),
    close: () => { ipcRenderer.send("maestro:window:close"); },
    onStateChange: (listener: (maximized: boolean) => void) => {
      const onStateChange = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized);
      ipcRenderer.on("maestro:window-state", onStateChange);
      return () => ipcRenderer.removeListener("maestro:window-state", onStateChange);
    },
  },
  events: {
    subscribe: subscribeToEventStream,
  },
});
