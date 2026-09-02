import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitOperationError } from "@maestro/domain";
import { commit, createBranch, createWorktree, headRevision, removeWorktree } from "./git-ops.js";

describe("local Git operations", () => {
  let repositoryPath: string;
  let baseRevision: string;

  beforeEach(() => {
    repositoryPath = mkdtempSync(join(tmpdir(), "maestro-git-test-"));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: repositoryPath });
    baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
  });

  afterEach(() => { rmSync(repositoryPath, { recursive: true, force: true }); });

  it("creates a branch at the exact base revision", async () => {
    await createBranch(repositoryPath, "goal/integration", baseRevision);
    const sha = execFileSync("git", ["rev-parse", "goal/integration"], { cwd: repositoryPath }).toString().trim();
    expect(sha).toBe(baseRevision);
  });

  it("creates a uniquely owned worktree, commits mission changes, and reports the real commit sha", async () => {
    await createBranch(repositoryPath, "worker/exec-1", baseRevision);
    const worktreePath = join(repositoryPath, "..", "maestro-worker-worktree");
    try {
      await createWorktree(repositoryPath, worktreePath, "worker/exec-1");
      const fs = await import("node:fs/promises");
      await fs.writeFile(join(worktreePath, "change.txt"), "mission-only change");
      const result = await commit(worktreePath, "mission: add change", "worker", "worker@example.com");
      expect(/^[0-9a-f]{40}$/.test(result.commitSha)).toBe(true);
      expect(await headRevision(worktreePath)).toBe(result.commitSha);
      expect(result.commitSha).not.toBe(baseRevision);
    } finally {
      await removeWorktree(repositoryPath, worktreePath).catch(() => undefined);
    }
  });

  it("reads the exact head of a named repository branch", async () => {
    await createBranch(repositoryPath, "goal/integration", baseRevision);
    const worktreePath = join(repositoryPath, "..", "maestro-goal-head-worktree");
    try {
      await createWorktree(repositoryPath, worktreePath, "goal/integration");
      const fs = await import("node:fs/promises");
      await fs.writeFile(join(worktreePath, "integrated.txt"), "integrated change");
      const result = await commit(worktreePath, "mission: integrate", "worker", "worker@example.com");
      expect(await headRevision(repositoryPath, "goal/integration")).toBe(result.commitSha);
    } finally {
      await removeWorktree(repositoryPath, worktreePath).catch(() => undefined);
    }
  });

  it("rejects an invalid Git operation with a GitOperationError, not a raw process error", async () => {
    await expect(createBranch(repositoryPath, "x", "not-a-real-revision")).rejects.toBeInstanceOf(GitOperationError);
  });
});
