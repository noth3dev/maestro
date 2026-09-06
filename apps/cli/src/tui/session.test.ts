import { describe, expect, it } from "vitest";
import { loadWorkspaceSession, saveWorkspaceSession, sessionFileFor } from "./session.js";

describe("workspace session", () => {
  it("round trips non-secret workspace session metadata", async () => {
    const baseDir = "/tmp/maestro-session-test";
    const session = { workspacePath: "/work/acme", projectId: "project-1", goalId: "goal-1", lastEventCursor: "42" };
    await saveWorkspaceSession(session, baseDir);
    await expect(loadWorkspaceSession(session.workspacePath, baseDir)).resolves.toEqual(session);
    expect(sessionFileFor(session.workspacePath, baseDir)).toContain(baseDir);
    expect(JSON.stringify(session)).not.toContain("token");
  });

  it("returns undefined for a workspace without a saved session", async () => {
    await expect(loadWorkspaceSession("/work/unknown", "/tmp/maestro-session-empty")).resolves.toBeUndefined();
  });
});
