import { describe, expect, it } from "vitest";
import { resolveWorkspace, workspaceIdentity } from "./workspace.js";

describe("resolveWorkspace", () => {
  it("uses the git root for durable identity and cwd for non-git fallback", () => {
    expect(workspaceIdentity({ cwd: "/repo/packages/app", gitRoot: "/repo" })).toBe("/repo");
    expect(workspaceIdentity({ cwd: "/tmp/scratch" })).toBe("/tmp/scratch");
  });

  it("returns the current directory and its git root", async () => {
    const workspace = await resolveWorkspace(process.cwd());
    expect(workspace.cwd).toBe(process.cwd());
    expect(workspace.gitRoot).toBeTruthy();
  });
});
