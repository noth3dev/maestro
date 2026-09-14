import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isExposedMethod } from "./apiBridge.js";

describe("Carnegie renderer API bridge", () => {
  it("exposes durable Inbox approvals and the existing Concertmaster conversation path", () => {
    for (const method of ["listInbox", "denyCriticalAction", "createConversation", "sendConversationTurn"]) expect(isExposedMethod(method)).toBe(true);
  });

  it("keeps the CommonJS preload allow-list in sync for these renderer calls", () => {
    const preload = readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
    for (const method of ["listInbox", "denyCriticalAction", "createConversation", "sendConversationTurn"]) expect(preload).toContain(`"${method}"`);
  });
});
