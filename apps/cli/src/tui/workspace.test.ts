import { describe, expect, it } from "vitest";
import { resolveWorkspace } from "./workspace.js";

describe("resolveWorkspace", () => {
  it("returns the current directory and its git root", async () => {
    const workspace = await resolveWorkspace(process.cwd());
    expect(workspace.cwd).toBe(process.cwd());
    expect(workspace.gitRoot).toBeTruthy();
  });
});
