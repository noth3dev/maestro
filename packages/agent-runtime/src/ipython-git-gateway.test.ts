import { mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createIpPythonGitRevisionAdapter } from "./ipython-git-gateway.js";

const binding = {
  sessionId: "session-1",
  commandId: "command-1",
  toolCallId: "tool-1",
  operatorId: "operator-1",
  projectId: "project-1",
  goalId: "goal-1",
  pathScope: ["/workspace/project-1"],
  outboundDataClasses: ["workspace"],
  authorityPolicyVersion: 1,
  controlEpoch: "1",
  budgetEffectCents: 0,
} as const;

describe("IPython Git read gateway", () => {
  it("reads the fixed repository through the injected GitPort", async () => {
    const headRevision = vi.fn(async (repositoryPath: string, ref?: string) => `${repositoryPath}:${ref ?? "HEAD"}`);
    const readRevision = createIpPythonGitRevisionAdapter({ git: { headRevision }, repositoryPath: "/workspace/project-1" });

    await expect(readRevision(binding, "HEAD")).resolves.toBe("/workspace/project-1:HEAD");
    expect(headRevision).toHaveBeenCalledOnce();
    expect(headRevision).toHaveBeenCalledWith("/workspace/project-1", "HEAD");
  });

  it("rejects a repository outside the immutable Goal path scope", async () => {
    const headRevision = vi.fn(async () => "should-not-run");
    const readRevision = createIpPythonGitRevisionAdapter({ git: { headRevision }, repositoryPath: "/workspace/other-project" });

    await expect(readRevision(binding, "HEAD")).rejects.toThrow("outside the Goal scope");
    expect(headRevision).not.toHaveBeenCalled();
  });

  it("rejects a symlinked repository that resolves outside the Goal path scope", async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "maestro-ipython-git-"));
    try {
      const scope = join(temporaryRoot, "scope");
      const outside = join(temporaryRoot, "outside");
      const linkedRepository = join(scope, "repository");
      mkdirSync(scope);
      mkdirSync(outside);
      symlinkSync(outside, linkedRepository, "dir");
      expect(readlinkSync(linkedRepository)).toBe(outside);
      const headRevision = vi.fn(async () => "should-not-run");
      const readRevision = createIpPythonGitRevisionAdapter({ git: { headRevision }, repositoryPath: linkedRepository });

      await expect(readRevision({ ...binding, pathScope: [scope] }, "HEAD")).rejects.toThrow("outside the Goal scope");
      expect(headRevision).not.toHaveBeenCalled();
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("resolves relative Goal scopes from the configured repository root", async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "maestro-ipython-git-"));
    try {
      const repository = join(temporaryRoot, "repo");
      mkdirSync(repository);
      const headRevision = vi.fn(async () => "abc123");
      const readRevision = createIpPythonGitRevisionAdapter({ git: { headRevision }, repositoryPath: repository, scopeRoot: temporaryRoot });
      await expect(readRevision({ ...binding, pathScope: ["repo"] }, "HEAD")).resolves.toBe("abc123");
    } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
  });

  it("rejects invalid Git refs before calling GitPort", async () => {
    const headRevision = vi.fn(async () => "should-not-run");
    const readRevision = createIpPythonGitRevisionAdapter({ git: { headRevision }, repositoryPath: "/workspace/project-1" });

    await expect(readRevision(binding, "HEAD\n--upload-pack=evil")).rejects.toThrow("ref is invalid");
    expect(headRevision).not.toHaveBeenCalled();
  });

  it("does not hide GitPort failures", async () => {
    const headRevision = vi.fn(async () => { throw new Error("git read failed"); });
    const readRevision = createIpPythonGitRevisionAdapter({ git: { headRevision }, repositoryPath: "/workspace/project-1" });

    await expect(readRevision(binding, "HEAD")).rejects.toThrow("git read failed");
  });
});
