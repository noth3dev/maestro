import { describe, expect, it } from "vitest";

describe("git-adapter surface", () => {
  it("pins the barrel export list", async () => {
    const surface = await import("./index.js");
    expect(Object.keys(surface).sort()).toMatchInlineSnapshot(`
      [
        "GitAuthorizationError",
        "GitOutcomeUnknownError",
        "assertGoalScopedWorkspacePath",
        "assertWorkspacePath",
        "createLocalGitPort",
      ]
    `);
  });
});
