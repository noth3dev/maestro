import { describe, expect, it, vi } from "vitest";
import type { IpPythonExecutionResult, IpPythonHostBinding } from "./ipython-tool.js";
import { createIpPythonLocalEffectsGateway, createLocalHostRequestHandler, type IpPythonLocalEffectAdapters } from "./ipython-local-effects.js";

const binding: IpPythonHostBinding = {
  sessionId: "session-1",
  commandId: "command-1",
  toolCallId: "tool-1",
  operatorId: "worker-1",
  projectId: "project-1",
  goalId: "goal-1",
  pathScope: ["/workspace/project"],
  outboundDataClasses: ["workspace"],
  authorityPolicyVersion: 7,
  controlEpoch: "epoch-1",
  budgetEffectCents: 0,
};

const ok = (content: string): IpPythonExecutionResult => ({ state: "ok", dataClass: "workspace", content });

function makeAdapters(): { adapters: IpPythonLocalEffectAdapters; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const track = (name: string, value: unknown): void => { (calls[name] ??= []).push(value); };
  return {
    calls,
    adapters: {
      writeFile: vi.fn(async (request) => { track("writeFile", request); return ok("written"); }),
      runTest: vi.fn(async (request) => { track("runTest", request); return ok("tested"); }),
      runShell: vi.fn(async (request) => { track("runShell", request); return ok("shelled"); }),
      runEnvironment: vi.fn(async (request) => { track("runEnvironment", request); return ok("changed"); }),
      gitCreateBranch: vi.fn(async (request) => { track("gitCreateBranch", request); return ok("branched"); }),
      gitCreateWorktree: vi.fn(async (request) => { track("gitCreateWorktree", request); return ok("worktree"); }),
      gitCommit: vi.fn(async (request) => { track("gitCommit", request); return ok("committed"); }),
      gitAdvanceBranch: vi.fn(async (request) => { track("gitAdvanceBranch", request); return ok("advanced"); }),
      gitRemoveWorktree: vi.fn(async (request) => { track("gitRemoveWorktree", request); return ok("removed"); }),
    },
  };
}

describe("IPython authority-backed local effects", () => {
  it("routes local file, command, and Git requests with the immutable Goal binding", async () => {
    const fixture = makeAdapters();
    const { adapters, calls } = fixture;
    const gateway = createIpPythonLocalEffectsGateway({ adapters });

    await expect(gateway.handle(binding, { method: "write_file", payload: { path: "src/app.ts", content: "export {}" } })).resolves.toEqual(ok("written"));
    await expect(gateway.handle(binding, { method: "run_test", payload: { action: "git.remote.push", target: "npm test", argv: ["npm", "test"], cwd: "/workspace/project" } })).resolves.toEqual(ok("tested"));
    await expect(gateway.handle(binding, { method: "git_create_branch", payload: { branchName: "goal/one", baseRevision: "abc123" } })).resolves.toEqual(ok("branched"));

    expect(calls.writeFile?.[0]).toMatchObject({ binding, path: "src/app.ts", content: "export {}" });
    expect(calls.runTest?.[0]).toMatchObject({ binding, action: "project.test.run", target: "npm test", argv: ["npm", "test"], cwd: "/workspace/project" });
    expect(calls.gitCreateBranch?.[0]).toMatchObject({ binding, branchName: "goal/one", baseRevision: "abc123" });
  });

  it("rejects remote, network, unknown, and malformed effects before an adapter can run", async () => {
    const fixture = makeAdapters();
    const { adapters } = fixture;
    const gateway = createIpPythonLocalEffectsGateway({ adapters });

    await expect(gateway.handle(binding, { method: "git_remote_push", payload: { remote: "origin", ref: "main" } })).rejects.toThrow("not allowed");
    await expect(gateway.handle(binding, { method: "network_request", payload: { url: "https://example.com" } })).rejects.toThrow("not allowed");
    await expect(gateway.handle(binding, { method: "unknown", payload: {} })).rejects.toThrow("not allowed");
    await expect(gateway.handle(binding, { method: "write_file", payload: { path: "../escape", content: "bad" } })).rejects.toThrow("path");
    await expect(gateway.handle(binding, { method: "run_shell", payload: { action: "shell.command", target: "echo bad", argv: ["sh", "-c", "echo bad"], cwd: "/workspace/project" } })).rejects.toThrow("command");
    await expect(gateway.handle(binding, { method: "run_shell", payload: { target: "origin/main", argv: ["git", "push", "origin", "main"], cwd: "/workspace/project" } })).rejects.toThrow("Git");
    await expect(gateway.handle(binding, { method: "run_shell", payload: { target: "wrapped", argv: ["env", "git", "push", "origin", "main"], cwd: "/workspace/project" } })).rejects.toThrow("wrapper");
    await expect(gateway.handle(binding, { method: "run_shell", payload: { target: "interpreter", argv: ["node", "-e", "require('child_process').exec('git push')"], cwd: "/workspace/project" } })).rejects.toThrow("wrapper");
    await expect(gateway.handle(binding, { method: "run_shell", payload: { target: "npm script", argv: ["npm", "run", "release"], cwd: "/workspace/project" } })).rejects.toThrow("package-manager");
    await expect(gateway.handle(binding, { method: "run_command", payload: { argv: ["npm", "test"], cwd: "/workspace/project" } })).rejects.toThrow("not allowed");
    await expect(gateway.handle({ ...binding, pathScope: ["/workspace/project/allowed"] }, { method: "run_test", payload: { action: "test", target: "outside", argv: ["npm", "test"], cwd: "/workspace/project/outside" } })).rejects.toThrow("outside");
    await expect(gateway.handle({ ...binding, pathScope: ["/workspace/project/allowed"] }, { method: "run_test", payload: { action: "test", target: "traversal", argv: ["echo", "../outside"], cwd: "/workspace/project/allowed" } })).rejects.toThrow("escapes");
    await expect(gateway.handle({ ...binding, pathScope: ["/workspace/project/allowed"] }, { method: "run_test", payload: { action: "test", target: "flag traversal", argv: ["echo", "--output=../outside"], cwd: "/workspace/project/allowed" } })).rejects.toThrow("escapes");
    await expect(gateway.handle({ ...binding, pathScope: ["/workspace/project/allowed"] }, { method: "run_test", payload: { action: "test", target: "flag absolute", argv: ["echo", "--output=/workspace/project/outside"], cwd: "/workspace/project/allowed" } })).rejects.toThrow("outside");

    for (const adapter of Object.values(adapters)) expect(adapter).not.toHaveBeenCalled();
  });

  it("prepares a local effect without invoking its adapter until commit", async () => {
    const fixture = makeAdapters();
    const { adapters } = fixture;
    const gateway = createIpPythonLocalEffectsGateway({ adapters });
    const request = { method: "write_file", payload: { path: "src/app.ts", content: "prepared" } };
    const prepared = await gateway.prepare(binding, request);
    expect(adapters.writeFile).not.toHaveBeenCalled();
    expect(prepared.result).toMatchObject({ state: "ok", content: "[effect prepared]" });
    await expect(prepared.commit()).resolves.toEqual(ok("written"));
    expect(adapters.writeFile).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid command during preparation before any commit can run", async () => {
    const fixture = makeAdapters();
    const { adapters } = fixture;
    const gateway = createIpPythonLocalEffectsGateway({ adapters });

    await expect(gateway.prepare(binding, {
      method: "run_shell",
      payload: { target: "network", argv: ["curl", "https://example.com"], cwd: "/workspace/project" },
    })).rejects.toThrow("outside the Goal path scope");
    expect(adapters.runShell).not.toHaveBeenCalled();
  });

  it("resolves relative Goal scopes against the trusted workspace root", async () => {
    const fixture = makeAdapters();
    const { adapters } = fixture;
    const gateway = createIpPythonLocalEffectsGateway({ adapters, scopeRoot: "/workspace/project" });
    const scopedBinding = { ...binding, pathScope: ["allowed"] };

    await expect(gateway.handle(scopedBinding, {
      method: "run_test",
      payload: { target: "allowed", argv: ["echo", "ok"], cwd: "/workspace/project/allowed" },
    })).resolves.toEqual(ok("tested"));
  });

  it("preserves an adapter's unknown outcome instead of treating cancellation as success", async () => {
    const fixture = makeAdapters();
    const { adapters } = fixture;
    adapters.runTest = vi.fn(async () => ({ state: "unknown", dataClass: "workspace", content: "cancelled", reason: "cancellation_outcome_unknown" }));
    const gateway = createIpPythonLocalEffectsGateway({ adapters });

    await expect(gateway.handle(binding, { method: "run_test", payload: { action: "git.remote.push", target: "npm test", argv: ["npm", "test"], cwd: "/workspace/project" } })).resolves.toMatchObject({ state: "unknown", reason: "cancellation_outcome_unknown" });
  });

  it("exposes local effects through the host request handler without weakening read-only routing", async () => {
    const fixture = makeAdapters();
    const { adapters } = fixture;
    const handler = createLocalHostRequestHandler({
      binding,
      readOnly: { readFile: async () => ok("read"), gitRevision: async () => ok("abc123") },
      effects: createIpPythonLocalEffectsGateway({ adapters }),
    });

    await expect(handler({ requestId: "cell-1", hostRequestId: "host-1", method: "write_file", payload: { path: "src/app.ts", content: "ok" } })).resolves.toEqual(ok("written"));
    await expect(handler({ requestId: "cell-1", hostRequestId: "host-2", method: "git_revision", payload: { ref: "HEAD" } })).resolves.toEqual(ok("abc123"));
  });
});
