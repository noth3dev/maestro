import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { exposedApiMethods, isExposedMethod } from "./apiBridge.js";

describe("Carnegie renderer API bridge", () => {
  it("exposes durable Inbox approvals and the existing Concertmaster conversation path", () => {
    for (const method of [
      "listInbox",
      "denyCriticalAction",
      "createConversation",
      "sendConversationTurn",
      "createOvertureRun",
      "getOvertureRun",
      "sendOvertureOperatorMessage",
      "listOvertureMessages",
      "listOvertureEvents",
      "streamEvents",
    ])
      expect(isExposedMethod(method)).toBe(true);
  });

  it("exposes every method used by the full project execution path", () => {
    expect(isExposedMethod("createConversation")).toBe(true);
    expect(isExposedMethod("sendConversationTurn")).toBe(true);
    expect(isExposedMethod("getCouncil")).toBe(true);
    expect(isExposedMethod("observeWorker")).toBe(true);
    expect(isExposedMethod("advanceWorkerIntegration")).toBe(true);
    expect(isExposedMethod("getEvidenceDump")).toBe(true);
    expect(isExposedMethod("generateConcertmasterReport")).toBe(true);
  });

  it("exposes the full E5 API surface: workspace, conversation, goal, planning, worker, git, evidence, oversight, and reporting methods", () => {
    const required = [
      "createGoal",
      "listProjects",
      "getOrganization",
      "provisionProjectAccess",
      "getConversation",
      "cancelConversation",
      "listConversationEvents",
      "transitionGoal",
      "activateHead",
      "getCouncil",
      "getDepartmentPlan",
      "getMissionBundle",
      "getWorker",
      "observeWorker",
      "sendWorkerMessage",
      "freezeGoalIntegrationRevision",
      "advanceWorkerIntegration",
      "captureEvidence",
      "getEvidenceDump",
      "scanMetronome",
      "raiseMetronomeChallenge",
      "resolveMetronomeChallenge",
      "runEncoreReview",
      "generateConcertmasterReport",
      "startAccountLogin",
      "accountLoginStatus",
      "cancelAccountLogin",
      "logoutAccount",
    ];
    for (const method of required) expect(isExposedMethod(method)).toBe(true);
  });

  it("rejects a method that is not on the allow-list", () => {
    expect(isExposedMethod("deleteEverything")).toBe(false);
    expect(isExposedMethod("__proto__")).toBe(false);
  });

  it("keeps the CommonJS preload allow-list in sync for these renderer calls", () => {
    const preload = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
    for (const method of ["listInbox", "denyCriticalAction", "createConversation", "sendConversationTurn", "streamEvents"])
      expect(preload).toContain(`"${method}"`);
  });

  it("keeps every exposed method in sync with the duplicated preload allow-list", () => {
    const preload = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
    for (const method of exposedApiMethods) expect(preload).toContain(`"${method}"`);
  });

  it("exposes the provider authentication browser bridge", () => {
    const preload = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(preload).toContain('openProviderAuth: (url: string) => ipcRenderer.invoke("maestro:provider-auth:open", url)');
    expect(main).toContain('ipcMain.handle("maestro:provider-auth:open"');
    expect(main).toContain("isProviderAuthUrlAllowed(value)");
  });

  it("uses clone-safe callback IPC for streams instead of returning an AsyncIterable through contextBridge", () => {
    const preload = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
    expect(preload).toContain("subscribeToEventStream");
    expect(preload).toContain("events:");
    expect(preload).not.toContain("api.streamEvents =");
  });

  it("cleans active streams when a renderer navigates or its process disappears", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/did-start-navigation[\s\S]*stopEventStreamsForSender\(window\.webContents\)/);
    expect(main).toMatch(/render-process-gone[\s\S]*stopEventStreamsForSender\(window\.webContents\)/);
  });
});
