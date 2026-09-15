import { contextBridge, ipcRenderer } from "electron";

// ponytail: duplicated from electron/apiBridge.ts's `exposedApiMethods` rather than imported —
// contextBridge.exposeInMainWorld can only clone a plain object of functions (a Proxy fails with
// "An object could not be cloned"), and importing an ESM sibling into this CommonJS preload isn't
// reliable across Electron's bundled Node version. Keep this list in sync with apiBridge.ts.
type RendererEventStreamPort = {
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
};
const eventChannels = { start: "maestro:events:start", message: "maestro:events:message", stop: "maestro:events:stop" } as const;

function createRendererEventStream(port: RendererEventStreamPort, query: { projectId: string; after: string }, signal?: AbortSignal): AsyncIterable<unknown> {
  const streamId = globalThis.crypto.randomUUID();
  const queue: unknown[] = [];
  const waiters: Array<{ resolve: (result: IteratorResult<unknown>) => void; reject: (error: Error) => void }> = [];
  let started = false;
  let closed = false;
  let failure: Error | undefined;

  const onMessage = (...args: unknown[]): void => {
    const streamIdIndex = typeof args[0] === "string" ? 0 : 1;
    if (args[streamIdIndex] !== streamId) return;
    const message = args[streamIdIndex + 1] as { kind?: string; event?: unknown; message?: string } | undefined;
    if (message?.kind === "event") {
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter.resolve({ done: false, value: message.event });
      else queue.push(message.event);
    } else if (message?.kind === "end") {
      close();
    } else if (message?.kind === "error") {
      failure = new Error(message.message || "SSE stream failed");
      closed = true;
      cleanup();
      while (waiters.length > 0) waiters.shift()?.reject(failure);
    }
  };
  const cleanup = (): void => {
    port.removeListener(eventChannels.message, onMessage);
    signal?.removeEventListener("abort", onAbort);
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    cleanup();
    while (waiters.length > 0) waiters.shift()?.resolve({ done: true, value: undefined });
  };
  const stop = (): void => {
    if (closed) return;
    if (started) port.send(eventChannels.stop, streamId);
    close();
  };
  const onAbort = (): void => stop();
  const next = (): Promise<IteratorResult<unknown>> => {
    if (!started) {
      started = true;
      port.on(eventChannels.message, onMessage);
      if (signal?.aborted) stop();
      else {
        signal?.addEventListener("abort", onAbort, { once: true });
        port.send(eventChannels.start, streamId, query);
      }
    }
    if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() });
    if (failure !== undefined) return Promise.reject(failure);
    if (closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };
  const iterator: AsyncIterator<unknown> = { next, return: async () => { stop(); return { done: true, value: undefined }; } };
  return { [Symbol.asyncIterator]: () => iterator };
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

api.streamEvents = (...args: unknown[]) => {
  const query = args[0] as { projectId: string; after: string };
  const options = args[1] as { signal?: AbortSignal } | undefined;
  return createRendererEventStream(ipcRenderer as unknown as RendererEventStreamPort, query, options?.signal);
};

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
