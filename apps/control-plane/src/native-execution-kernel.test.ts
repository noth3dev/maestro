import { describe, expect, it, vi } from "vitest";
import type { ExecutionKernelPort, InvocationStatus, SpawnRequest } from "@maestro/domain";
import { createIpPythonSessionManager, createIpPythonTool, ToolRegistry, type GatewayBinding, type ModelGatewayPort, type ModelTurnResult } from "@maestro/agent-runtime";
import { createNativeExecutionKernel } from "./native-execution-kernel.js";

const binding: GatewayBinding = {
  bindingId: "binding-test",
  gatewayInstanceId: "gateway-test",
  provider: { provider: "test", id: "model-a" },
  account: { providerId: "test", accountRef: "test-account", authMode: "api-key" },
  dataPolicyHash: "policy-test",
};

function result(requestId: string): ModelTurnResult {
  return {
    requestId,
    model: binding.provider,
    text: "native answer",
    toolCalls: [],
    stopReason: "end_turn",
    usage: { state: "available", totalTokens: 3 },
  };
}

function fakeGateway(): ModelGatewayPort & { admit: ReturnType<typeof vi.fn>; turn: ReturnType<typeof vi.fn> } {
  const gateway = {
    listModels: vi.fn(async () => []),
    admit: vi.fn(async () => binding),
    turn: vi.fn(async (request: { requestId: string }) => result(request.requestId)),
    cancel: vi.fn(async () => ({ state: "confirmed" as const })),
    recover: vi.fn(async () => "unknown" as const),
    close: vi.fn(async () => undefined),
  } satisfies ModelGatewayPort;
  return gateway as typeof gateway & { admit: ReturnType<typeof vi.fn>; turn: ReturnType<typeof vi.fn> };
}

function rootRequest(model = "test/model-a"): SpawnRequest {
  return {
    name: "native-root",
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
      grantId: "grant-1",
      allowedTools: [],
      allowedSkills: [],
      modelPolicy: [model],
      pathScope: [],
      outboundDataClasses: ["public"],
      remaining: { modelTurns: 2, toolCalls: 0, childCalls: 0, outputTokens: 128, wallTimeMs: 10_000, retryCount: 0 },
    },
    modelPolicy: [model],
    idempotencyKey: "command-1",
  };
}

function createKernel(gateway = fakeGateway()): { kernel: ExecutionKernelPort; gateway: ReturnType<typeof fakeGateway> } {
  return {
    gateway,
    kernel: createNativeExecutionKernel({
      gateway,
      gatewayOperatorId: "operator-1",
      accountRefs: { test: "test-account" },
      dataPolicyHash: "policy-test",
      tools: new ToolRegistry(),
    }),
  };
}

describe("native Control Plane execution kernel", () => {
  it("admits the exact provider/model before spawn and routes the runtime by opaque refs", async () => {
    const { gateway, kernel } = createKernel();
    const spawned = await kernel.spawn(rootRequest());

    expect(gateway.admit).toHaveBeenCalledWith(expect.objectContaining({
      operatorId: "operator-1",
      providerId: "test",
      model: { provider: "test", id: "model-a" },
      accountRef: "test-account",
      dataPolicyHash: "policy-test",
    }));
    expect(await kernel.getModelIdentity(spawned.execution)).toEqual({ provider: "test", id: "model-a" });

    await kernel.prompt(spawned.execution, "hello");
    expect(await kernel.getInvocationStatus(spawned.invocation)).toBe<InvocationStatus>("succeeded");
    expect((await kernel.observe(spawned.execution))[0]?.answer).toEqual({ state: "available", text: "native answer" });
  });

  it("rejects an unscoped native spawn before gateway admission", async () => {
    const { gateway, kernel } = createKernel();
    await expect(kernel.spawn({ name: "unscoped" })).rejects.toThrow("host-owned context");
    expect(gateway.admit).not.toHaveBeenCalled();
  });

  it("rejects a caller-supplied account mismatch before gateway admission", async () => {
    const { gateway, kernel } = createKernel();
    const request = rootRequest();
    const mismatched = { ...request, context: { ...request.context!, accountRef: "wrong-account" } };
    await expect(kernel.spawn(mismatched)).rejects.toThrow("account binding mismatch");
    expect(gateway.admit).not.toHaveBeenCalled();
  });

  it("rejects multiple or grant-mismatched model policies before gateway admission", async () => {
    const { gateway, kernel } = createKernel();
    await expect(kernel.spawn({ ...rootRequest(), modelPolicy: ["test/model-a", "test/model-b"] })).rejects.toThrow("exactly one model policy");
    await expect(kernel.spawn({ ...rootRequest(), grant: { ...rootRequest().grant!, modelPolicy: ["test/model-b"] } })).rejects.toThrow("grant model policy mismatch");
    expect(gateway.admit).not.toHaveBeenCalled();
  });

  it("rejects a gateway binding whose selected identity differs from the approved model", async () => {
    const gateway = fakeGateway();
    gateway.admit.mockResolvedValueOnce({ ...binding, provider: { provider: "test", id: "model-b" } });
    const { kernel } = createKernel(gateway);
    await expect(kernel.spawn(rootRequest())).rejects.toThrow("unexpected model identity");
    expect(gateway.admit).toHaveBeenCalledOnce();
  });

  it("closes a shared gateway once after multiple native runtimes are admitted", async () => {
    const { gateway, kernel } = createKernel();
    await kernel.spawn(rootRequest());
    await kernel.spawn({ ...rootRequest(), idempotencyKey: "command-2", name: "native-root-2" });
    await kernel.close?.();
    expect(gateway.close).toHaveBeenCalledTimes(1);
  });


  it("routes an allowed ipython call through the native registry boundary", async () => {
    let calls = 0;
    const gateway = fakeGateway();
    gateway.turn.mockImplementation(async (request: { requestId: string; tools?: readonly { name: string }[] }) => {
      calls += 1;
      if (calls === 1) return {
        requestId: request.requestId,
        model: binding.provider,
        text: "",
        toolCalls: [{ id: "ipython-call-1", name: "ipython", arguments: { state: "valid", value: { code: "1 + 1" } } }],
        stopReason: "tool_use" as const,
        usage: { state: "available" as const, totalTokens: 1 },
      };
      return result(request.requestId);
    });
    const manager = createIpPythonSessionManager({
      createKernel: () => ({
        async execute() { return { state: "ok" as const, dataClass: "workspace" as const, content: "2" }; },
      }),
    });
    const tools = new ToolRegistry();
    tools.register(createIpPythonTool({ sessions: manager }));
    const kernel = createNativeExecutionKernel({ gateway, gatewayOperatorId: "operator-1", accountRefs: { test: "test-account" }, dataPolicyHash: "policy-test", tools });
    const request = rootRequest();
    const spawned = await kernel.spawn({
      ...request,
      grant: { ...request.grant!, allowedTools: ["ipython"], outboundDataClasses: ["workspace"], remaining: { ...request.grant!.remaining, toolCalls: 1 } },
    });

    await kernel.prompt(spawned.execution, "run the calculation");

    expect(await kernel.getInvocationStatus(spawned.invocation)).toBe("succeeded");
    expect(gateway.turn).toHaveBeenCalledTimes(2);
    await manager.close();
    await kernel.close();
  });

  it("evicts a released root execution and keeps duplicate release idempotent", async () => {
    const { kernel } = createKernel();
    const spawned = await kernel.spawn(rootRequest());

    await kernel.release!(spawned.invocation);

    await expect(kernel.getModelIdentity(spawned.execution)).rejects.toThrow("operation unavailable");
    await expect(kernel.observe(spawned.execution)).resolves.toEqual([]);
    await expect(kernel.release!(spawned.invocation)).resolves.toBeUndefined();
    await expect(kernel.release!("unknown-invocation" as never)).resolves.toBeUndefined();
  });

  it("retains a shared execution for a child until the child is released", async () => {
    const { kernel } = createKernel();
    const request = rootRequest();
    const root = await kernel.spawn({
      ...request,
      grant: { ...request.grant!, remaining: { ...request.grant!.remaining, childCalls: 1 } },
    });
    const child = await kernel.spawn({
      name: "native-child",
      parent: root.execution,
      prompt: "child prompt",
      context: request.context,
      grant: {
        ...request.grant!,
        grantId: "child-grant",
        parentGrantId: request.grant!.grantId,
        remaining: { ...request.grant!.remaining, childCalls: 0 },
      },
      modelPolicy: request.modelPolicy,
      idempotencyKey: "child-command-1",
    });

    await kernel.release!(root.invocation);

    expect(await kernel.getInvocationStatus(root.invocation)).toBe("unknown");
    expect(await kernel.getModelIdentity(root.execution)).toEqual(binding.provider);
    expect((await kernel.observe(root.execution)).some((item) => item.invocation === child.invocation)).toBe(true);
    await kernel.sendMessage(root.execution, child.invocation, "continue child");

    await kernel.release!(child.invocation);
    await expect(kernel.getModelIdentity(root.execution)).rejects.toThrow("operation unavailable");
  });

  it("keeps the root execution after child release until the root is released", async () => {
    const { kernel } = createKernel();
    const request = rootRequest();
    const root = await kernel.spawn({
      ...request,
      grant: { ...request.grant!, remaining: { ...request.grant!.remaining, childCalls: 1 } },
    });
    const child = await kernel.spawn({
      name: "native-child",
      parent: root.execution,
      prompt: "child prompt",
      context: request.context,
      grant: {
        ...request.grant!,
        grantId: "child-grant",
        parentGrantId: request.grant!.grantId,
        remaining: { ...request.grant!.remaining, childCalls: 0 },
      },
      modelPolicy: request.modelPolicy,
      idempotencyKey: "child-command-1",
    });

    await kernel.release!(child.invocation);

    expect(await kernel.getModelIdentity(root.execution)).toEqual(binding.provider);
    await kernel.release!(root.invocation);
    await expect(kernel.getModelIdentity(root.execution)).rejects.toThrow("operation unavailable");
  });

});
