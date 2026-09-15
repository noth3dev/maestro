import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isExposedMethod } from "./apiBridge.js";

describe("Carnegie renderer API bridge", () => {
  it("exposes durable Inbox approvals and the existing Concertmaster conversation path", () => {
    for (const method of ["listInbox", "denyCriticalAction", "createConversation", "sendConversationTurn", "streamEvents"]) expect(isExposedMethod(method)).toBe(true);
  });

  it("keeps the CommonJS preload allow-list in sync for these renderer calls", () => {
    const preload = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
    for (const method of ["listInbox", "denyCriticalAction", "createConversation", "sendConversationTurn", "streamEvents"]) expect(preload).toContain(`"${method}"`);
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
