import { describe, expect, it, vi } from "vitest";
import type { ExecutionKernelPort, ExecutionRef, InvocationRef, InvocationObservation, ModelIdentity, SpawnRequest } from "@maestro/domain";
import { createMaestroAgentRuntime, ToolRegistry, type GatewayBinding, type MaestroAgentRuntime, type ModelGatewayPort } from "@maestro/agent-runtime";
import { createNativeExecutionKernel } from "./native-execution-kernel.js";

vi.mock("@maestro/agent-runtime", async () => {
  const actual = await vi.importActual<typeof import("@maestro/agent-runtime")>("@maestro/agent-runtime");
  return { ...actual, createMaestroAgentRuntime: vi.fn() };
});

const binding: GatewayBinding = {
  bindingId: "binding-race",
  gatewayInstanceId: "gateway-race",
  provider: { provider: "test", id: "model-a" },
  account: { providerId: "test", accountRef: "test-account", authMode: "api-key" },
  dataPolicyHash: "policy-race",
};

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function rootRequest(): SpawnRequest {
  return {
    name: "race-root",
    context: {
      operatorId: "operator-1",
      projectId: "project-1",
      goalId: "goal-1",
      missionBundleId: "bundle-1",
      policyVersion: "policy-1",
      authorityPolicyVersion: 1,
      controlEpoch: "epoch-1",
      budgetEffectCents: 0,
      accountRef: "test-account",
    },
    grant: {
      grantId: "root-grant",
      allowedTools: [],
      allowedSkills: [],
      modelPolicy: ["test/model-a"],
      pathScope: [],
      outboundDataClasses: ["public"],
      remaining: { modelTurns: 2, toolCalls: 0, childCalls: 1, outputTokens: 128, wallTimeMs: 10_000, retryCount: 0 },
    },
    modelPolicy: ["test/model-a"],
    idempotencyKey: "race-root-command",
  };
}

describe("native execution kernel child registration race", () => {
  it("keeps a delayed child routable across root release", async () => {
    const execution = "execution-race" as ExecutionRef;
    const rootInvocation = "root-invocation" as InvocationRef;
    const childInvocation = "child-invocation" as InvocationRef;
    const childEntered = deferred<void>();
    const childGate = deferred<void>();
    let rootReleased = false;
    let childRegistered = false;
    let childReleased = false;
    let childStatus: "queued" | "succeeded" = "queued";
    let runtimeCloseCalls = 0;
    const childObservation = (): InvocationObservation => ({
      invocation: childInvocation,
      name: "race-child",
      status: childStatus,
      toolEvents: { state: "empty", events: [] },
      usage: { state: "unknown" },
      answer: childStatus === "succeeded" ? { state: "available", text: "child answer" } : { state: "unavailable", reason: "snapshot-unavailable" },
    });
    const runtime = {
      async spawn(request: SpawnRequest) {
        if (request.parent === undefined) return { execution, invocation: rootInvocation };
        childEntered.resolve();
        await childGate.promise;
        childRegistered = true;
        return { execution, invocation: childInvocation };
      },
      async prompt() {
        if (rootReleased) throw new Error("root released");
      },
      async observe() {
        return childRegistered && !childReleased ? [childObservation()] : [];
      },
      async sendMessage(_execution: ExecutionRef, invocation: InvocationRef) {
        if (invocation !== childInvocation || !childRegistered || childReleased) throw new Error("unknown invocation");
        childStatus = "succeeded";
      },
      async cancel() { return { cancelled: false }; },
      async getModelIdentity(): Promise<ModelIdentity> { return binding.provider; },
      async getToolEvents() { return { state: "empty" as const, events: [] as const }; },
      async getUsage() { return { state: "unknown" as const }; },
      async getInvocationStatus(invocation: InvocationRef) {
        if (invocation === rootInvocation && rootReleased) return "unknown" as const;
        if (invocation === childInvocation && childRegistered && !childReleased) return childStatus;
        return "unknown" as const;
      },
      async resume() { throw new Error("resume unavailable"); },
      async reconnect() { throw new Error("reconnect unavailable"); },
      async release(invocation: InvocationRef) {
        if (invocation === rootInvocation) rootReleased = true;
        if (invocation === childInvocation) childReleased = true;
      },
      async close() { runtimeCloseCalls += 1; },
      inspectGrantForTest() { throw new Error("not used"); },
    } as unknown as MaestroAgentRuntime;
    vi.mocked(createMaestroAgentRuntime).mockReturnValue(runtime);
    const gateway = {
      admit: vi.fn(async () => binding),
      close: vi.fn(async () => undefined),
    } as unknown as ModelGatewayPort & { admit: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    const kernel: ExecutionKernelPort & { close(): Promise<void> } = createNativeExecutionKernel({
      gateway,
      gatewayOperatorId: "operator-1",
      accountRefs: { test: "test-account" },
      dataPolicyHash: "policy-race",
      tools: new ToolRegistry(),
    });
    const root = await kernel.spawn(rootRequest());
    const request = rootRequest();
    const pendingChild = kernel.spawn({
      ...request,
      name: "race-child",
      parent: root.execution,
      prompt: "child prompt",
      grant: { ...request.grant!, grantId: "child-grant", parentGrantId: request.grant!.grantId, remaining: { ...request.grant!.remaining, childCalls: 0 } },
      idempotencyKey: "race-child-command",
    });

    await childEntered.promise;
    await kernel.release!(root.invocation);
    await expect(kernel.getModelIdentity(root.execution)).rejects.toThrow("operation unavailable");
    await expect(kernel.getExecutionBinding!(root.execution)).rejects.toThrow("operation unavailable");
    childGate.resolve(undefined);
    const child = await pendingChild;

    await kernel.sendMessage(root.execution, child.invocation, "continue child");
    expect(await kernel.getInvocationStatus(child.invocation)).toBe("succeeded");
    expect((await kernel.observe(root.execution)).map((item) => item.invocation)).toEqual([child.invocation]);
    expect(gateway.close).not.toHaveBeenCalled();

    await kernel.release!(child.invocation);
    await expect(kernel.getModelIdentity(root.execution)).rejects.toThrow("operation unavailable");
    expect(runtimeCloseCalls).toBe(1);
    expect(gateway.close).not.toHaveBeenCalled();
    await kernel.close();
    expect(gateway.close).toHaveBeenCalledOnce();
  });

  it("closes a root runtime that finishes admitting after kernel close", async () => {
    const admissionEntered = deferred<void>();
    const admissionGate = deferred<GatewayBinding>();
    const runtimeClose = vi.fn(async () => undefined);
    const runtime = {
      async spawn() {
        return { execution: "late-execution" as ExecutionRef, invocation: "late-invocation" as InvocationRef };
      },
      async close() {
        await runtimeClose();
      },
    } as unknown as MaestroAgentRuntime;
    vi.mocked(createMaestroAgentRuntime).mockReturnValue(runtime);
    const gateway = {
      admit: vi.fn(async () => {
        admissionEntered.resolve();
        return admissionGate.promise;
      }),
      close: vi.fn(async () => undefined),
    } as unknown as ModelGatewayPort & { admit: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    const kernel = createNativeExecutionKernel({
      gateway,
      gatewayOperatorId: "operator-1",
      accountRefs: { test: "test-account" },
      dataPolicyHash: "policy-race",
      tools: new ToolRegistry(),
    });

    const pendingSpawn = kernel.spawn(rootRequest());
    await admissionEntered.promise;
    const closing = kernel.close();
    admissionGate.resolve(binding);

    await expect(pendingSpawn).rejects.toThrow("native execution kernel is closed");
    await closing;
    expect(runtimeClose).toHaveBeenCalledOnce();
    expect(gateway.close).toHaveBeenCalledOnce();
  });

});
