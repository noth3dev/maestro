import { describe, expect, it } from "vitest";
import { advanceWorkspaceSession, loadWorkspaceSession, saveWorkspaceSession, sessionFileFor, startNewConversationSession } from "./session.js";

describe("workspace session", () => {
  it("round trips non-secret workspace session metadata", async () => {
    const baseDir = "/tmp/maestro-session-test";
    const session = { workspacePath: "/work/acme", projectId: "project-1", goalId: "goal-1", lastEventCursor: "42" };
    await saveWorkspaceSession(session, baseDir);
    await expect(loadWorkspaceSession(session.workspacePath, baseDir)).resolves.toEqual(session);
    expect(sessionFileFor(session.workspacePath, baseDir)).toContain(baseDir);
    expect(JSON.stringify(session)).not.toContain("token");
  });

  it("starts a new conversation without dropping workspace binding or event progress", () => {
    expect(startNewConversationSession("/work/acme", { workspacePath: "/work/acme", projectId: "project-1", goalId: "goal-1", lastEventCursor: "42" })).toEqual({
      workspacePath: "/work/acme", projectId: "project-1", lastEventCursor: "42",
    });
  });

  it("binds the active Goal when a replayed event establishes the session", () => {
    expect(advanceWorkspaceSession("/work/acme", undefined, {
      cursor: "42", eventId: "event-1", projectId: "project-1", goalId: "goal-1", aggregateVersion: "1",
      eventType: "goal.running", schemaVersion: 1, payload: {}, occurredAt: "2030-01-01T00:00:00.000Z",
    })).toEqual({ workspacePath: "/work/acme", projectId: "project-1", goalId: "goal-1", lastEventCursor: "42" });
  });

  it("returns undefined for a workspace without a saved session", async () => {
    await expect(loadWorkspaceSession("/work/unknown", "/tmp/maestro-session-empty")).resolves.toBeUndefined();
  });
});
