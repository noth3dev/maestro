import { mkdirSync, mkdtempSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AuthorityDecision, AuthorityRepository } from "@maestro/authority";
import { AuthorizedEffectExecutor } from "@maestro/authority";
import { createAuthorizedFileEditPort, FileEditAuthorizationError, FileEditBoundaryError } from "./file-edit-adapter.js";

function context() {
  return { commandId: "command-1", projectId: "project-1", actorId: "worker-1", goalId: "goal-1", policyVersion: 7, budgetEffectCents: 0, controlEpoch: "epoch-1" };
}

function authority(target: string, allow = true) {
  const calls: AuthorityDecision[] = [];
  const repository: AuthorityRepository = {
    load: async (request) => allow ? [{ recordId: "grant-1", kind: "grant", commandId: null, projectId: request.projectId, actorId: request.actorId, goalId: request.goalId, action: request.action, target, policyVersion: request.policyVersion, budgetEffectCents: request.budgetEffectCents, expiresAt: new Date("2030-01-01T00:00:00.000Z") }] : [],
    appendDecision: async ({ decision }) => { calls.push(decision); },
    recheckControl: async () => ({ effect: "allow" }),
  };
  return { executor: new AuthorizedEffectExecutor(repository, () => new Date("2029-01-01T00:00:00.000Z")), calls };
}

describe("authority-backed file edit adapter", () => {
  it("builds the exact project.file.edit request and writes only after authority allows", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-file-edit-"));
    try {
      const target = join(root, "src", "app.ts");
      mkdirSync(join(root, "src"));
      const { executor, calls } = authority(JSON.stringify([target]));
      const port = createAuthorizedFileEditPort({ authority: executor, context: context(), workspaceRoot: root, pathScope: ["src"] });

      await port.writeFile("src/app.ts", "export {}\n");

      expect(readFileSync(target, "utf8")).toBe("export {}\n");
      expect(calls[0]).toMatchObject({ effect: "allow", classification: "ordinary", request: { commandId: "command-1", projectId: "project-1", actorId: "worker-1", goalId: "goal-1", action: "project.file.edit", target: JSON.stringify([target]), policyVersion: 7, budgetEffectCents: 0, controlEpoch: "epoch-1" } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not touch the file when authority rejects or when the path escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-file-edit-"));
    try {
      const denied = authority(JSON.stringify([join(root, "safe.txt")]), false);
      const port = createAuthorizedFileEditPort({ authority: denied.executor, context: context(), workspaceRoot: root });
      await expect(port.writeFile("safe.txt", "nope")).rejects.toBeInstanceOf(FileEditAuthorizationError);
      expect(() => readFileSync(join(root, "safe.txt"))).toThrow();

      const execute = vi.fn(async () => undefined);
      const boundary = createAuthorizedFileEditPort({ authority: { execute }, context: context(), workspaceRoot: root });
      await expect(boundary.writeFile("../escape.txt", "bad")).rejects.toBeInstanceOf(FileEditBoundaryError);
      expect(execute).not.toHaveBeenCalled();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects symlink escapes and sensitive files before authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-file-edit-"));
    const outside = mkdtempSync(join(tmpdir(), "maestro-file-edit-outside-"));
    try {
      symlinkSync(outside, join(root, "linked"), "dir");
      const execute = vi.fn(async () => undefined);
      const port = createAuthorizedFileEditPort({ authority: { execute }, context: context(), workspaceRoot: root });
      await expect(port.writeFile("linked/escape.txt", "bad")).rejects.toBeInstanceOf(FileEditBoundaryError);
      await expect(port.writeFile(".env", "secret")).rejects.toBeInstanceOf(FileEditBoundaryError);
      expect(execute).not.toHaveBeenCalled();
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  });
});
