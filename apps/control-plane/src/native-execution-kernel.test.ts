import { describe, expect, it, vi } from "vitest";
import type { ExecutionKernelPort, InvocationStatus, SpawnRequest } from "@maestro/domain";
import { ToolRegistry, type GatewayBinding, type ModelGatewayPort, type ModelTurnResult } from "@maestro/agent-runtime";
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

  it("closes a shared gateway once after multiple native runtimes are admitted", async () => {
    const { gateway, kernel } = createKernel();
    await kernel.spawn(rootRequest());
    await kernel.spawn({ ...rootRequest(), idempotencyKey: "command-2", name: "native-root-2" });
    await kernel.close?.();
    expect(gateway.close).toHaveBeenCalledTimes(1);
  });
});
