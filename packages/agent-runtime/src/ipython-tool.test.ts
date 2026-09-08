import { describe, expect, it } from "vitest";
import { createIpPythonSessionManager, createIpPythonTool, type IpPythonKernel } from "./ipython-tool.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const context = {
  operatorId: "operator-1",
  projectId: "project-1",
  goalId: "goal-1",
  missionBundleId: "bundle-1",
  policyVersion: "1",
  conversationId: "conversation-1",
  turnId: "turn-1",
  sessionVersion: 0,
  controllerPolicyHash: "policy-1",
  capabilityGrant: {
    grantId: "grant-1",
    allowedTools: ["ipython"],
    allowedSkills: [],
    modelPolicy: ["fake/model-a"],
    pathScope: ["/workspace/project-1"],
    outboundDataClasses: ["public", "workspace"],
    remaining: { modelTurns: 1, toolCalls: 2, childCalls: 0, outputTokens: 128, wallTimeMs: 10_000, retryCount: 0 },
  },
  outboundDataPolicyHash: "data-policy-1",
};

describe("persistent ipython tool boundary", () => {
  it("serializes blocks for one Goal-bound session", async () => {
    const first = deferred<{ content: string }>();
    const calls: Array<{ sessionId: string; code: string }> = [];
    const kernel: IpPythonKernel = {
      async execute(request) {
        calls.push({ sessionId: request.sessionId, code: request.code });
        if (calls.length === 1) return first.promise;
        return { state: "ok", dataClass: "workspace", content: `second:${request.code}` };
      },
    };
    const manager = createIpPythonSessionManager({ createKernel: () => kernel });

    const pendingFirst = manager.execute({ sessionId: "project-1:goal-1:conversation-1", code: "first" });
    const pendingSecond = manager.execute({ sessionId: "project-1:goal-1:conversation-1", code: "second" });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ sessionId: "project-1:goal-1:conversation-1", code: "first" }]);

    first.resolve({ state: "ok", dataClass: "workspace", content: "first-result" });
    await expect(pendingFirst).resolves.toEqual({ state: "ok", dataClass: "workspace", content: "first-result" });
    await expect(pendingSecond).resolves.toEqual({ state: "ok", dataClass: "workspace", content: "second:second" });
    expect(calls).toHaveLength(2);
  });

  it("keeps different Goal sessions isolated", async () => {
    const active = new Set<string>();
    const started = deferred<void>();
    const release = deferred<void>();
    const kernel: IpPythonKernel = {
      async execute(request) {
        active.add(request.sessionId);
        if (active.size === 2) started.resolve();
        await release.promise;
        active.delete(request.sessionId);
        return { state: "ok", dataClass: "workspace", content: request.sessionId };
      },
    };
    const manager = createIpPythonSessionManager({ createKernel: () => kernel });

    const results = Promise.all([
      manager.execute({ sessionId: "project-1:goal-1:conversation-1", code: "one" }),
      manager.execute({ sessionId: "project-1:goal-2:conversation-2", code: "two" }),
    ]);
    await started.promise;
    expect(active).toEqual(new Set(["project-1:goal-1:conversation-1", "project-1:goal-2:conversation-2"]));
    release.resolve();
    await expect(results).resolves.toEqual([
      { state: "ok", dataClass: "workspace", content: "project-1:goal-1:conversation-1" },
      { state: "ok", dataClass: "workspace", content: "project-1:goal-2:conversation-2" },
    ]);
  });

  it("binds the model-facing tool to project, Goal, and conversation identity", async () => {
    const requests: Array<{ sessionId: string; code: string }> = [];
    const manager = createIpPythonSessionManager({
      createKernel: () => ({
        async execute(request) {
          requests.push(request);
          return { state: "ok", dataClass: "workspace", content: "read-only result" };
        },
      }),
    });
    const tool = createIpPythonTool({ sessions: manager });

    await expect(tool.execute({ code: "show_lines('README.md')" }, context)).resolves.toEqual({ status: "ok", content: "read-only result" });
    expect(requests).toEqual([{ sessionId: '["project-1","goal-1","conversation-1"]', code: "show_lines('README.md')" }]);
  });


  it("provisions a distinct kernel namespace for each Goal-bound session", async () => {
    const state = new Map<string, string>();
    const kernels = new Map<string, IpPythonKernel>();
    const manager = createIpPythonSessionManager({
      createKernel: (sessionId) => {
        const kernel: IpPythonKernel = {
          async execute(request) {
            if (request.code === "set") state.set(sessionId, "private");
            return { state: "ok", dataClass: "workspace", content: state.get(sessionId) ?? "empty" };
          },
        };
        kernels.set(sessionId, kernel);
        return kernel;
      },
    });

    await expect(manager.execute({ sessionId: "project-1:goal-1:conversation-1", code: "set" })).resolves.toMatchObject({ content: "private" });
    await expect(manager.execute({ sessionId: "project-1:goal-2:conversation-2", code: "read" })).resolves.toMatchObject({ content: "empty" });
    expect(kernels.get("project-1:goal-1:conversation-1")).not.toBe(kernels.get("project-1:goal-2:conversation-2"));
  });

  it("uses collision-safe session identity encoding", async () => {
    const seen: string[] = [];
    const manager = createIpPythonSessionManager({
      createKernel: (sessionId) => ({
        async execute() {
          seen.push(sessionId);
          return { state: "ok", dataClass: "workspace", content: "ok" };
        },
      }),
    });
    const tool = createIpPythonTool({ sessions: manager });
    const first = { ...context, projectId: "a:b", goalId: "c", conversationId: "d" };
    const second = { ...context, projectId: "a", goalId: "b:c", conversationId: "d" };

    await tool.execute({ code: "one" }, first);
    await tool.execute({ code: "two" }, second);
    expect(seen[0]).not.toBe(seen[1]);
  });

});
