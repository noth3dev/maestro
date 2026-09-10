import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReleaseScenarioFixture } from "./fixture.mjs";

describe("release scenario fixture", () => {
  it("creates a disposable real project strictly below the configured worktree root", async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), "maestro-release-scenario-test-"));
    const root = join(worktreeRoot, "target");
    try {
      const fixture = await createReleaseScenarioFixture({ root, worktreeRoot });
      expect(fixture.root).toBe(root);
      expect(fixture.worktreeRoot).toBe(worktreeRoot);
      expect(await readFile(join(root, ".git", "HEAD"), "utf8")).toContain("refs/heads");
      expect(await readFile(fixture.targetTest, "utf8")).toContain("discount");
      expect(await readFile(fixture.seededDefect, "utf8")).toContain("seeded defect");
      expect(await readFile(fixture.repairedImplementation, "utf8")).toContain("repaired counterpart");
      expect(await readFile(fixture.unsupportedAssertion, "utf8")).toContain("unsupported assertion");
      expect(await readFile(fixture.restartTrigger, "utf8")).toContain("checkpoint");
      expect(await readFile(fixture.ambiguousAction, "utf8")).toContain("ambiguous");
      expect(await readFile(fixture.remotePushAttempt, "utf8")).toContain("not-attempted");
      await expect(createReleaseScenarioFixture({ root: join(tmpdir(), "outside-release-target"), worktreeRoot })).rejects.toThrow("below MAESTRO_WORKTREE_ROOT");
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });
});
