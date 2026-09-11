import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MissionBundleSubstanceSchema } from "@maestro/contracts";
import { describe, expect, it } from "vitest";
import { createReleaseScenarioFixture } from "./fixture.mjs";

const execFile = promisify(execFileCallback);

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
      const occupied = join(worktreeRoot, "occupied");
      await mkdir(occupied, { recursive: true });
      await writeFile(join(occupied, "keep.txt"), "keep");
      await expect(createReleaseScenarioFixture({ root: occupied, worktreeRoot })).rejects.toThrow("must be empty");
      await expect(createReleaseScenarioFixture({ root: join(tmpdir(), "outside-release-target"), worktreeRoot })).rejects.toThrow("below MAESTRO_WORKTREE_ROOT");
      await expect(createReleaseScenarioFixture({ worktreeRoot: "" })).rejects.toThrow("MAESTRO_WORKTREE_ROOT is required");
      await expect(createReleaseScenarioFixture({ worktreeRoot: join(tmpdir(), "missing-release-root", String(Date.now())) })).rejects.toThrow("must already exist");
      const outside = await mkdtemp(join(tmpdir(), "maestro-release-scenario-outside-"));
      await symlink(outside, join(worktreeRoot, "escape"), "dir");
      await expect(createReleaseScenarioFixture({ root: join(worktreeRoot, "escape", "target"), worktreeRoot })).rejects.toThrow("escapes MAESTRO_WORKTREE_ROOT");
      await rm(outside, { recursive: true, force: true });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it("emits a Mission Bundle repair hold accepted by the production schema", async () => {
    const worktreeRoot = await mkdtemp(join(tmpdir(), "maestro-release-scenario-input-"));
    const output = join(worktreeRoot, "mission.json");
    try {
      await execFile(process.execPath, ["test/release-scenario/write-input.mjs", "--kind", "mission", "--project", randomUUID(), "--contract", randomUUID(), "--out", output], { cwd: process.cwd() });
      const generated = JSON.parse(await readFile(output, "utf8")) as { substance: unknown };
      expect(() => MissionBundleSubstanceSchema.parse(generated.substance)).not.toThrow();
      const substance = MissionBundleSubstanceSchema.parse(generated.substance);
      expect(substance.repairHold?.repetitionScope).toEqual({ kind: "bounded_count", count: 1 });
    } finally {
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });
});
