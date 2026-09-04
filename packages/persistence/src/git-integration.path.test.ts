import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitPort } from "@maestro/domain";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordGoalIntegrationBranch, recordWorkerWorktree } from "./git-integration.js";

describe("Git path containment at the persistence boundary", () => {
  let workspaceRoot: string;
  let outsidePath: string;
  const priorWorkspaceRoot = process.env.MAESTRO_WORKTREE_ROOT;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "maestro-persistence-workspace-"));
    outsidePath = mkdtempSync(join(tmpdir(), "maestro-persistence-outside-"));
    process.env.MAESTRO_WORKTREE_ROOT = workspaceRoot;
  });

  afterEach(() => {
    if (priorWorkspaceRoot === undefined) delete process.env.MAESTRO_WORKTREE_ROOT;
    else process.env.MAESTRO_WORKTREE_ROOT = priorWorkspaceRoot;
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsidePath, { recursive: true, force: true });
  });

  it("rejects an outside repository before opening a database transaction or invoking Git", async () => {
    const pool = { connect: vi.fn() } as unknown as Pool;
    const git = { createBranch: vi.fn() } as unknown as GitPort;
    const proof = { goalId: "goal-1", ownerId: "owner-1", fencingToken: "1" };

    await expect(recordGoalIntegrationBranch(pool, git, proof.goalId, outsidePath, "goal/integration", "a".repeat(40), proof))
      .rejects.toThrow("outside configured workspace root");
    expect(pool.connect).not.toHaveBeenCalled();
    expect(git.createBranch).not.toHaveBeenCalled();
  });

  it("rejects an outside worktree before opening a database transaction or invoking Git", async () => {
    const pool = { connect: vi.fn() } as unknown as Pool;
    const git = { createBranch: vi.fn(), createWorktree: vi.fn() } as unknown as GitPort;
    const proof = { goalId: "goal-1", ownerId: "owner-1", fencingToken: "1" };

    await expect(recordWorkerWorktree(pool, git, "worker-1", outsidePath, proof, {
      actorId: "actor-1", sessionRef: "session-1", commandId: "command-1",
    })).rejects.toThrow("outside configured workspace root");
    expect(pool.connect).not.toHaveBeenCalled();
    expect(git.createBranch).not.toHaveBeenCalled();
    expect(git.createWorktree).not.toHaveBeenCalled();
  });
});
