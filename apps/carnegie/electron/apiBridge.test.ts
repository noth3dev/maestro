import { describe, expect, it } from "vitest";
import { isExposedMethod } from "./apiBridge.js";

describe("Carnegie renderer API bridge", () => {
  it("exposes durable Inbox approvals and the existing Concertmaster conversation path", () => {
    for (const method of ["listInbox", "denyCriticalAction", "createConversation", "sendConversationTurn"]) expect(isExposedMethod(method)).toBe(true);
  });
});
