import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ActionRequest, AuthorityDecision } from "@maestro/authority";
import { createAuthorizedFileEditPort } from "@maestro/environment-adapter";
import { createIpPythonLocalEffectsGateway } from "@maestro/agent-runtime";
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


  it("routes real Python write_file through the optional authority-backed local-effect gateway", async () => {
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
      const file = createAuthorizedFileEditPort({ authority, context: { ...binding, policyVersion: binding.authorityPolicyVersion }, workspaceRoot: root, pathScope: [root] });
      const localEffects = createIpPythonLocalEffectsGateway({ adapters: {
        writeFile: async ({ path, content }) => { await file.writeFile(path, content); return { state: "ok", dataClass: "workspace", content: "written" }; },
        runCommand: async () => ({ state: "error", dataClass: "workspace", content: "not configured" }),
        gitCreateBranch: async () => ({ state: "error", dataClass: "workspace", content: "not configured" }),
        gitCreateWorktree: async () => ({ state: "error", dataClass: "workspace", content: "not configured" }),
        gitCommit: async () => ({ state: "error", dataClass: "workspace", content: "not configured" }),
        gitAdvanceBranch: async () => ({ state: "error", dataClass: "workspace", content: "not configured" }),
        gitRemoveWorktree: async () => ({ state: "error", dataClass: "workspace", content: "not configured" }),
      } });
      const kernel = createIpPythonProductionKernel({ authority, workspaceRoot: root, pythonExecutable: "/usr/bin/python3", localEffects }, binding.sessionId, { ...binding, pathScope: [root] });
      try {
        await expect(kernel.execute({ sessionId: binding.sessionId, code: "print(write_file('README.md', 'local effect'))", binding: { ...binding, pathScope: [root] } })).resolves.toMatchObject({ state: "ok" });
        expect(readFileSync(join(root, "README.md"), "utf8")).toBe("local effect");
        expect(calls).toEqual(["project.file.edit"]);
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
