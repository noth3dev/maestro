import { describe, expect, it } from "vitest";
import type { Workspace } from "./workspace.js";
import { resolveRetryWorkspace } from "./retry-workspace.js";

const workspace: Workspace = { cwd: "/workspace" };

describe("retry workspace resolution", () => {
  it("returns the workspace resolved during a retry", async () => {
    await expect(resolveRetryWorkspace("/workspace", async () => workspace)).resolves.toEqual({ kind: "resolved", workspace });
  });

  it("returns a user-facing error when retry resolution fails", async () => {
    await expect(
      resolveRetryWorkspace("/workspace", async () => {
        throw new Error("missing directory");
      }),
    ).resolves.toEqual({
      kind: "error",
      message: "missing directory",
    });
  });
});
