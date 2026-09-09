import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ActionRequest, AuthorityDecision } from "@maestro/authority";
import type { EnvironmentRecord } from "@maestro/domain";
import { createIpPythonProductionKernel } from "./ipython-composition.js";

const binding = {
  sessionId: "session-composition",
  commandId: "command-composition",
  toolCallId: "tool-composition",
  operatorId: "operator-composition",
  projectId: "project-composition",
  goalId: "goal-composition",
  pathScope: [] as readonly string[],
  outboundDataClasses: ["workspace"],
  authorityPolicyVersion: 1,
  controlEpoch: "1",
  budgetEffectCents: 0,
} as const;



function localEnvironment(root: string): EnvironmentRecord {
  return {
    environmentId: "environment-composition", recipeVersion: 1, goalId: binding.goalId, departmentId: "department-composition", workerId: binding.operatorId, projectId: binding.projectId, missionId: "mission-composition", type: "local_worktree",
    recipe: {}, resolvedInputs: {}, capabilities: [{ name: "echo", version: "1" }], secretsReferences: [],
    boundaries: { network: ["none"], filesystem: [root], processes: ["echo"], browsers: [], devices: [] },
    resources: { cpuMillis: 1000, memoryMb: 64, diskMb: 64, processCount: 1, durationSeconds: 30 },
    expiresAt: "2030-01-01T00:00:00.000Z", state: "ready", setupLog: [], health: { status: "healthy", checkedAt: null, summary: null }, contentIdentity: "a".repeat(64),
    cleanup: { status: "not_scheduled", scheduledAt: null, completedAt: null, ownedResources: [], retainedEvidence: [] },
  };
}

describe("Control Plane IPython composition", () => {
  it("routes real Python read_file and git_revision through authority-backed adapters", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-"));
    try {
      writeFileSync(join(root, "README.md"), "composition evidence");
      execFileSync("/usr/bin/git", ["init", "--quiet", root]);
      execFileSync("/usr/bin/git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", "README.md"]);
      execFileSync("/usr/bin/git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "--no-verify", "-m", "init"]);
      const calls: string[] = [];
      const authority = {
        async execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision> {
          calls.push(request.action);
          await effect();
          return { effect: "allow", reason: "test_allow", classification: "ordinary", request, recordId: "test-record" };
        },
      };
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3" }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "print(read_file('README.md'))\nprint(git_revision())", binding: { ...binding, pathScope: [root] } })).resolves.toMatchObject({ state: "ok", content: expect.stringContaining("composition evidence") });
        expect(calls).toEqual(["project.file.read", "git.local.revision.read"]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });


  it("routes real Python file and test effects through composed authority-backed adapters", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-write-"));
    try {
      const calls: string[] = [];
      const authority = {
        async execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision> {
          calls.push(request.action);
          await effect();
          return { effect: "allow", reason: "test_allow", classification: "ordinary", request, recordId: "test-record" };
        },
      };
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root) }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "print(write_file('README.md', 'local effect'))\nprint(run_test('echo', ['echo', 'test effect'], '"+root+"'))", binding: { ...binding, pathScope: [root] } })).resolves.toMatchObject({ state: "ok" });
        expect(readFileSync(join(root, "README.md"), "utf8")).toBe("local effect");
        expect(calls).toEqual(["project.file.edit", "project.test.run"]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("routes real Python local Git mutations through the fixed repository authority port", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-git-"));
    try {
      writeFileSync(join(root, "README.md"), "git evidence");
      execFileSync("/usr/bin/git", ["init", "--quiet", root]);
      execFileSync("/usr/bin/git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", "README.md"]);
      execFileSync("/usr/bin/git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "--no-verify", "-m", "init"]);
      const calls: string[] = [];
      const authority = {
        async execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision> {
          calls.push(request.action);
          await effect();
          return { effect: "allow", reason: "test_allow", classification: "ordinary", request, recordId: "test-record" };
        },
      };
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root) }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "print(git_create_branch('goal/test', 'HEAD'))", binding: { ...binding, pathScope: [root] } })).resolves.toMatchObject({ state: "ok" });
        expect(execFileSync("/usr/bin/git", ["-C", root, "branch", "--list", "goal/test"], { encoding: "utf8" })).toContain("goal/test");
        expect(calls).toEqual(["git.local.branch.create"]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("denies file reads outside the Goal path scope", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-scope-"));
    try {
      writeFileSync(join(root, "README.md"), "outside evidence");
      const scoped = join(root, "scoped");
      mkdirSync(scoped);
      const calls: string[] = [];
      const authority = {
        async execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision> {
          calls.push(request.action);
          await effect();
          return { effect: "allow", reason: "test_allow", classification: "ordinary", request, recordId: "test-record" };
        },
      };
      const scopedBinding = { ...binding, sessionId: "session-composition-scope", pathScope: [scoped] } as const;
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3" }, scopedBinding.sessionId, scopedBinding);
      try {
        await expect(kernel.execute({ sessionId: scopedBinding.sessionId, code: "print(read_file('README.md'))", binding: scopedBinding })).resolves.toMatchObject({ state: "error" });
        expect(calls).toEqual([]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
