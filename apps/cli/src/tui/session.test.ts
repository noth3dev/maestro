import { mkdir, stat, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { advanceWorkspaceSession, attachWorkspaceSession, loadWorkspaceSession, saveWorkspaceSession, selectWorkspaceGoal, sessionFileFor, startNewConversationSession } from "./session.js";

describe("workspace session", () => {
  it("round trips non-secret workspace session metadata", async () => {
    const baseDir = "/tmp/maestro-session-test";
    const session = { workspacePath: "/work/acme", projectId: "project-1", goalId: "goal-1", lastEventCursor: "42" };
    await saveWorkspaceSession(session, baseDir);
    await expect(loadWorkspaceSession(session.workspacePath, baseDir)).resolves.toEqual(session);
    const sessionFile = sessionFileFor(session.workspacePath, baseDir);
    expect(sessionFile).toContain(baseDir);
    expect((await stat(sessionFile)).mode & 0o777).toBe(0o600);
    expect((await stat(baseDir)).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(session)).not.toContain("token");
  });

  it("rejects malformed or secret-bearing session records", async () => {
    const baseDir = "/tmp/maestro-session-invalid";
    const file = sessionFileFor("/work/acme", baseDir);
    await mkdir(baseDir, { recursive: true });
    await writeFile(file, JSON.stringify({ workspacePath: "/work/acme", token: "secret" }));
    await expect(loadWorkspaceSession("/work/acme", baseDir)).resolves.toBeUndefined();
  });

  it("attaches an explicitly selected project without reusing another project's Goal cursor", () => {
    expect(attachWorkspaceSession("/work/acme", { workspacePath: "/work/acme", projectId: "old-project", goalId: "old-goal", lastEventCursor: "42" }, "new-project")).toEqual({
      workspacePath: "/work/acme", projectId: "new-project",
    });
  });

  it("selects a Goal without changing the project or event cursor", () => {
    expect(selectWorkspaceGoal("/work/acme", { workspacePath: "/work/acme", projectId: "project-1", lastEventCursor: "42" }, "goal-2")).toEqual({ workspacePath: "/work/acme", projectId: "project-1", goalId: "goal-2", lastEventCursor: "42" });
  });

  it("requires an attached project before selecting a Goal", () => {
    expect(() => selectWorkspaceGoal("/work/acme", undefined, "goal-1")).toThrow("A project must be attached before selecting a Goal");
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
