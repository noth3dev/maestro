import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionWorkspace, normalizeWorkspaceFilePath, SessionWorkspaceFileNotFoundError, SessionWorkspacePathError } from "./session-workspace.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const roots: string[] = [];

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "maestro-session-workspace-"));
  roots.push(root);
  return { root, workspace: createSessionWorkspace({ root }) };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("session workspace", () => {
  it("starts empty, then commits written files and lists them with a revision", async () => {
    const { workspace: sessions } = workspace();
    await expect(sessions.list(projectId, conversationId)).resolves.toEqual({ files: [], revision: null });

    const first = await sessions.write(projectId, conversationId, [
      { path: "plan00.md", content: "# Plan\n" },
      { path: "design/home.canvas", content: "<svg></svg>" },
    ], "Draft plan");
    expect(first.revision).toMatch(/^[0-9a-f]{40}$/);

    const listing = await sessions.list(projectId, conversationId);
    expect(listing.files.map((file) => file.path)).toEqual(["design/home.canvas", "plan00.md"]);
    expect(listing.revision).toBe(first.revision);
    await expect(sessions.read(projectId, conversationId, "plan00.md")).resolves.toEqual({ path: "plan00.md", content: "# Plan\n", revision: first.revision });

    const unchanged = await sessions.write(projectId, conversationId, [{ path: "plan00.md", content: "# Plan\n" }], "No-op");
    expect(unchanged.revision).toBe(first.revision);
    const second = await sessions.write(projectId, conversationId, [{ path: "plan00.md", content: "# Plan v2\n" }], "Revise plan");
    expect(second.revision).not.toBe(first.revision);
  });

  it("rejects traversal, hidden, and Git metadata paths", () => {
    for (const path of ["../x.md", "/etc/passwd", ".git/config", "a/../../b", "a//b", "", "a\\b", ".env"]) {
      expect(() => normalizeWorkspaceFilePath(path), path).toThrow(SessionWorkspacePathError);
    }
    expect(normalizeWorkspaceFilePath("research/api notes.md")).toBe("research/api notes.md");
  });

  it("does not follow symlinks out of the workspace root", async () => {
    const { root, workspace: sessions } = workspace();
    await sessions.write(projectId, conversationId, [{ path: "plan00.md", content: "ok" }], "init");
    const outside = mkdtempSync(join(tmpdir(), "maestro-outside-"));
    roots.push(outside);
    writeFileSync(join(outside, "secret.md"), "secret");
    const sessionRoot = join(root, "sessions", projectId, conversationId);
    symlinkSync(join(outside, "secret.md"), join(sessionRoot, "leak.md"));
    mkdirSync(join(sessionRoot, "nested"));
    symlinkSync(outside, join(sessionRoot, "nested", "dir"));
    await expect(sessions.read(projectId, conversationId, "leak.md")).rejects.toThrow();
    await expect(sessions.read(projectId, conversationId, "nested/dir/secret.md")).rejects.toThrow();
    expect((await sessions.list(projectId, conversationId)).files.map((file) => file.path)).toEqual(["plan00.md"]);
    await expect(sessions.read(projectId, conversationId, "missing.md")).rejects.toThrow(SessionWorkspaceFileNotFoundError);
  });

  it("rejects non-UUID workspace identities", async () => {
    const { workspace: sessions } = workspace();
    await expect(sessions.list("../escape", conversationId)).rejects.toThrow();
  });
});
