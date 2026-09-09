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



function localEnvironment(root: string, processName = "echo"): EnvironmentRecord {
  return {
    environmentId: "environment-composition", recipeVersion: 1, goalId: binding.goalId, departmentId: "department-composition", workerId: binding.operatorId, projectId: binding.projectId, missionId: "mission-composition", type: "local_worktree",
    recipe: {}, resolvedInputs: {}, capabilities: [{ name: processName, version: "1" }], secretsReferences: [],
    boundaries: { network: ["none"], filesystem: [root], processes: [processName], browsers: [], devices: [] },
    resources: { cpuMillis: 1000, memoryMb: 64, diskMb: 64, processCount: 1, durationSeconds: 30 },
    expiresAt: "2030-01-01T00:00:00.000Z", state: "ready", setupLog: [], health: { status: "healthy", checkedAt: null, summary: null }, contentIdentity: "a".repeat(64),
    cleanup: { status: "not_scheduled", scheduledAt: null, completedAt: null, ownedResources: [], retainedEvidence: [] },
  };
}


function twoStageOptions() {
  return {
    fencingToken: "fence-composition",
    approve: async (_effects: readonly unknown[], blockDigest: string) => ({ approvalId: "approval-composition", blockDigest, fencingToken: "fence-composition" }),
    isFencingCurrent: async () => true,
    recordEffectResult: async () => {},
    recordStageBoundary: async () => {},
  };
}

describe("Control Plane IPython composition", () => {
  it("fails closed instead of constructing an unstaged local-effect kernel", () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-unstaged-"));
    try {
      const authority = { async execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision> { await effect(); return { effect: "allow", reason: "test_allow", classification: "ordinary", request, recordId: "test-record" }; } };
      expect(() => createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root) }, binding.sessionId, binding)).toThrow("two-stage execution");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });


  it("uses each cell's command identity for file effects in one bound session", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-identity-"));
    try {
      const requests: ActionRequest[] = [];
      const authority = {
        async execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision> {
          requests.push(request);
          await effect();
          return { effect: "allow", reason: "test_allow", classification: "ordinary", request, recordId: "test-record" };
        },
      };
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root), twoStage: twoStageOptions() }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        const firstBinding = { ...binding, commandId: "command-one", toolCallId: "tool-one", pathScope: [root] };
        const secondBinding = { ...binding, commandId: "command-two", toolCallId: "tool-two", pathScope: [root] };
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "write_file('one.txt', 'one')", binding: firstBinding })).resolves.toMatchObject({ state: "ok" });
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "write_file('two.txt', 'two')", binding: secondBinding })).resolves.toMatchObject({ state: "ok" });
        expect(requests.filter((request) => request.action === "project.file.edit").map((request) => request.commandId)).toEqual(["command-one", "command-two"]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

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


  it("routes file effects and fails closed for unisolated local test effects", async () => {
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
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root), twoStage: twoStageOptions() }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "print(write_file('README.md', 'local effect'))\nprint(run_test('echo', ['echo', 'test effect'], '"+root+"'))", binding: { ...binding, pathScope: [root] } })).resolves.toMatchObject({ state: "unknown", reason: "partial_commit" });
        expect(readFileSync(join(root, "README.md"), "utf8")).toBe("local effect");
        expect(calls).toEqual(["project.file.edit"]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("propagates an IPython interrupt to a running local environment command", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-cancel-"));
    try {
      const authority = {
        async execute(request: ActionRequest, effect: () => Promise<unknown>): Promise<AuthorityDecision> {
          await effect();
          return { effect: "allow", reason: "test_allow", classification: "ordinary", request, recordId: "test-record" };
        },
      };
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root, "sleep"), twoStage: twoStageOptions() }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        const execution = kernel.execute({ sessionId: binding.sessionId, code: "run_test('sleep', ['sleep', '2'], '"+root+"')", binding: { ...binding, pathScope: [root] } });
        await kernel.interrupt?.(binding.sessionId);
        await expect(execution).resolves.toMatchObject({ state: "cancelled", reason: "stop_requested" });
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
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root), twoStage: twoStageOptions() }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "print(git_create_branch('goal/test', 'HEAD'))", binding: { ...binding, pathScope: [root] } })).resolves.toMatchObject({ state: "ok" });
        expect(execFileSync("/usr/bin/git", ["-C", root, "branch", "--list", "goal/test"], { encoding: "utf8" })).toContain("goal/test");
        expect(calls).toEqual(["git.local.branch.create"]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("reports unknown when an authorized Git mutation fails after starting", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-git-failure-"));
    try {
      writeFileSync(join(root, "README.md"), "git failure evidence");
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
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root), twoStage: twoStageOptions() }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "print(git_commit('"+root+"', 'no changes', 'Test', 'test@example.invalid'))", binding: { ...binding, pathScope: [root] } })).resolves.toMatchObject({ state: "unknown", reason: "effect_outcome_unknown" });
        expect(calls).toEqual(["git.local.commit"]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("denies local Git mutations outside the Goal path scope", async () => {
    const root = mkdtempSync(join(tmpdir(), "maestro-ipython-composition-git-scope-"));
    try {
      writeFileSync(join(root, "README.md"), "git scope evidence");
      execFileSync("/usr/bin/git", ["init", "--quiet", root]);
      execFileSync("/usr/bin/git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", "README.md"]);
      execFileSync("/usr/bin/git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "--no-verify", "-m", "init"]);
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
      const scopedBinding = { ...binding, sessionId: "session-composition-git-scope", pathScope: [scoped] } as const;
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEnvironment: localEnvironment(root), twoStage: twoStageOptions() }, scopedBinding.sessionId, scopedBinding);
      try {
        await expect(kernel.execute({ sessionId: scopedBinding.sessionId, code: "print(git_create_branch('goal/outside-scope', 'HEAD'))", binding: scopedBinding })).resolves.toMatchObject({ state: "error", content: expect.stringContaining("outside") });
        expect(execFileSync("/usr/bin/git", ["-C", root, "branch", "--list", "goal/outside-scope"], { encoding: "utf8" })).toBe("");
        expect(calls).toEqual([]);
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
        await expect(kernel.execute({ sessionId: scopedBinding.sessionId, code: "print(git_revision())", binding: scopedBinding })).resolves.toMatchObject({ state: "error", content: expect.stringContaining("outside") });
        expect(calls).toEqual([]);
      } finally { await kernel.close?.(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
