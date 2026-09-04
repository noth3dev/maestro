import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthorizedEffectExecutor, type AuthorityRecord, type AuthorityRepository } from "@maestro/authority";
import { GitOperationError } from "@maestro/domain";
import { createLocalGitPort } from "./git-ops.js";
import { localGitPort } from "../../../test/git-port.js";

const gitContext = {
  commandId: "authority-test-command",
  projectId: "project-1",
  actorId: "worker-1",
  goalId: "goal-1",
  policyVersion: 1,
  budgetEffectCents: 0,
  controlEpoch: "1",
};

function authorityWith(recordPatch: (request: Parameters<AuthorityRepository["load"]>[0]) => Partial<AuthorityRecord>) {
  const repository: AuthorityRepository = {
    async load(request) {
      return [{
        recordId: "test-grant",
        kind: "grant",
        commandId: null,
        ...request,
        expiresAt: new Date("2999-01-01T00:00:00Z"),
        ...recordPatch(request),
      }];
    },
    async appendDecision() {},
    async recheckControl() { return { effect: "allow" }; },
  };
  return new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00Z"));
}

describe("local Git operations", () => {
  let workspaceRoot: string;
  let repositoryPath: string;
  let baseRevision: string;
  const priorWorkspaceRoot = process.env.MAESTRO_WORKTREE_ROOT;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "maestro-git-workspace-"));
    process.env.MAESTRO_WORKTREE_ROOT = workspaceRoot;
    repositoryPath = join(workspaceRoot, "repository");
    mkdirSync(repositoryPath);
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: repositoryPath });
    baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
  });

  afterEach(() => {
    if (priorWorkspaceRoot === undefined) delete process.env.MAESTRO_WORKTREE_ROOT;
    else process.env.MAESTRO_WORKTREE_ROOT = priorWorkspaceRoot;
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("creates a branch at the exact base revision", async () => {
    await localGitPort.createBranch(repositoryPath, "goal/integration", baseRevision);
    const sha = execFileSync("git", ["rev-parse", "goal/integration"], { cwd: repositoryPath }).toString().trim();
    expect(sha).toBe(baseRevision);
  });

  it("creates a uniquely owned worktree, commits mission changes, and reports the real commit sha", async () => {
    await localGitPort.createBranch(repositoryPath, "worker/exec-1", baseRevision);
    const worktreePath = join(workspaceRoot, "maestro-worker-worktree");
    try {
      await localGitPort.createWorktree(repositoryPath, worktreePath, "worker/exec-1");
      const fs = await import("node:fs/promises");
      await fs.writeFile(join(worktreePath, "change.txt"), "mission-only change");
      const result = await localGitPort.commit(worktreePath, "mission: add change", "worker", "worker@example.com");
      expect(/^[0-9a-f]{40}$/.test(result.commitSha)).toBe(true);
      expect(await localGitPort.headRevision(worktreePath)).toBe(result.commitSha);
      expect(result.commitSha).not.toBe(baseRevision);
    } finally {
      await localGitPort.removeWorktree(repositoryPath, worktreePath).catch(() => undefined);
    }
  });

  it("advances a branch only to a descendant commit", async () => {
    await localGitPort.createBranch(repositoryPath, "goal/integration", baseRevision);
    await localGitPort.createBranch(repositoryPath, "worker/advance", baseRevision);
    const worktreePath = join(workspaceRoot, "maestro-advance-worktree");
    try {
      await localGitPort.createWorktree(repositoryPath, worktreePath, "worker/advance");
      const fs = await import("node:fs/promises");
      await fs.writeFile(join(worktreePath, "integrated.txt"), "integrated change");
      const result = await localGitPort.commit(worktreePath, "mission: integrate", "worker", "worker@example.com");
      await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, result.commitSha);
      expect(await localGitPort.headRevision(repositoryPath, "goal/integration")).toBe(result.commitSha);
      await expect(localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, baseRevision)).rejects.toBeInstanceOf(GitOperationError);
    } finally {
      await localGitPort.removeWorktree(repositoryPath, worktreePath).catch(() => undefined);
    }
  });

  it("reads the exact head of a named repository branch", async () => {
    await localGitPort.createBranch(repositoryPath, "goal/integration", baseRevision);
    const worktreePath = join(workspaceRoot, "maestro-goal-head-worktree");
    try {
      await localGitPort.createWorktree(repositoryPath, worktreePath, "goal/integration");
      const fs = await import("node:fs/promises");
      await fs.writeFile(join(worktreePath, "integrated.txt"), "integrated change");
      const result = await localGitPort.commit(worktreePath, "mission: integrate", "worker", "worker@example.com");
      expect(await localGitPort.headRevision(repositoryPath, "goal/integration")).toBe(result.commitSha);
    } finally {
      await localGitPort.removeWorktree(repositoryPath, worktreePath).catch(() => undefined);
    }
  });

  it("rejects repository and worktree paths outside the configured workspace root", async () => {
    const outsideRepositoryPath = mkdtempSync(join(tmpdir(), "maestro-git-outside-repository-"));
    const outsideWorktreePath = mkdtempSync(join(tmpdir(), "maestro-git-outside-worktree-"));
    try {
      await expect(localGitPort.createBranch(outsideRepositoryPath, "goal/integration", baseRevision))
        .rejects.toThrow("outside configured workspace root");
      await expect(localGitPort.createWorktree(repositoryPath, outsideWorktreePath, "goal/integration"))
        .rejects.toThrow("outside configured workspace root");
    } finally {
      rmSync(outsideRepositoryPath, { recursive: true, force: true });
      rmSync(outsideWorktreePath, { recursive: true, force: true });
    }
  });

  it("fails closed when the workspace root is not configured", async () => {
    delete process.env.MAESTRO_WORKTREE_ROOT;
    await expect(localGitPort.createBranch(repositoryPath, "goal/integration", baseRevision))
      .rejects.toThrow("MAESTRO_WORKTREE_ROOT must be configured");
  });

  it("rejects a symlink that resolves outside the configured workspace root", async () => {
    const outsideRepositoryPath = mkdtempSync(join(tmpdir(), "maestro-git-symlink-target-"));
    const symlinkPath = join(workspaceRoot, "repository-link");
    try {
      symlinkSync(outsideRepositoryPath, symlinkPath, "dir");
      await expect(localGitPort.createBranch(symlinkPath, "goal/integration", baseRevision))
        .rejects.toThrow("outside configured workspace root");
    } finally {
      rmSync(symlinkPath, { force: true });
      rmSync(outsideRepositoryPath, { recursive: true, force: true });
    }
  });

  it.each([
    ["expired", (request: Parameters<AuthorityRepository["load"]>[0]) => ({ expiresAt: new Date("2028-01-01T00:00:00Z") }), "expired_grant"],
    ["out-of-scope", (request: Parameters<AuthorityRepository["load"]>[0]) => ({ target: "another-repository" }), "no_grant"],
    ["forged-actor", (request: Parameters<AuthorityRepository["load"]>[0]) => ({ actorId: "real-worker" }), "no_grant"],
  ] as const)("rejects %s authority before spawning Git", async (_label, recordPatch, reason) => {
    const deniedPort = createLocalGitPort({ authority: authorityWith(recordPatch), context: gitContext });
    await expect(deniedPort.createBranch(repositoryPath, `denied/${_label}`, baseRevision))
      .rejects.toThrow(`not authorized: ${reason}`);
    expect(() => execFileSync("git", ["rev-parse", "--verify", `refs/heads/denied/${_label}`], { cwd: repositoryPath }))
      .toThrow();
  });

  it("rejects an invalid Git operation with a GitOperationError, not a raw process error", async () => {
    await expect(localGitPort.createBranch(repositoryPath, "x", "not-a-real-revision")).rejects.toBeInstanceOf(GitOperationError);
  });
});
