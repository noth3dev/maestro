import { describe, expect, it, vi } from "vitest";
import type { InvocationObservation, ModelIdentity } from "@maestro/domain";
import type { GatewayBinding, ModelGatewayPort, ModelTurnResult } from "./model-provider.js";
import { createMaestroAgentRuntime, ToolRegistry } from "./agent-runtime.js";

const identity: ModelIdentity = { provider: "fake", id: "model-a" };
const binding: GatewayBinding = { bindingId: "binding-1", gatewayInstanceId: "gateway-1", provider: identity, account: { providerId: "fake", accountRef: "account-1", authMode: "api-key" }, dataPolicyHash: "policy-1" };
const grant = { grantId: "grant-1", allowedTools: ["readGoal"], allowedSkills: [], modelPolicy: ["fake/model-a"], pathScope: [], outboundDataClasses: ["public"], remaining: { modelTurns: 3, toolCalls: 2, childCalls: 0, outputTokens: 128, wallTimeMs: 10_000, retryCount: 0 } } as const;

function gateway(): ModelGatewayPort & { calls: number } {
  let calls = 0;
  return {
    get calls() { return calls; },
    async listModels() { return []; },
    async admit() { return binding; },
    async turn(request): Promise<ModelTurnResult> {
      calls += 1;
      if (calls === 1) {
        return { requestId: request.requestId, model: identity, text: "", toolCalls: [{ id: "call-1", name: "readGoal", arguments: { state: "valid", value: { goalId: "wrong-goal" } } }], stopReason: "tool_use", usage: { state: "available", totalTokens: 5 } };
      }
      return { requestId: request.requestId, model: identity, text: "Goal is healthy", toolCalls: [], stopReason: "end_turn", usage: { state: "available", totalTokens: 9 } };
    },
    async cancel() { return { state: "confirmed" as const }; },
    async recover() { return "reconnected" as const; },
    async close() {},
  };
}

describe("native Maestro agent runtime", () => {
  it("executes only registered tools with host-owned context and bounded continuation", async () => {
    const modelGateway = gateway();
    const execute = vi.fn(async (args: unknown, context: { projectId: string; goalId: string }) => ({ status: "ok" as const, content: JSON.stringify({ projectId: context.projectId, goalId: context.goalId, args }) }));
    const tools = new ToolRegistry();
    tools.register({ name: "readGoal", version: "1", description: "Read Goal", inputSchema: { parse: (value: unknown) => value }, outputSchema: { parse: (value: unknown) => value }, modelInputSchema: { type: "object" }, allowsParallel: false, outboundDataClass: "public", execute });
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools });
    const spawned = await runtime.spawn({ name: "controller", modelPolicy: ["fake/model-a"], idempotencyKey: "root-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant });
    await runtime.prompt(spawned.execution, "show the Goal");

    expect(execute).toHaveBeenCalledWith({ goalId: "wrong-goal" }, expect.objectContaining({ operatorId: "operator-1", projectId: "project-1", goalId: "goal-1" }));
    expect(modelGateway.calls).toBe(2);
    expect((await runtime.getInvocationStatus(spawned.invocation))).toBe("succeeded");
    expect((await runtime.getModelIdentity(spawned.execution))).toEqual(identity);
    expect((await runtime.observe(spawned.execution))).toEqual(expect.arrayContaining([expect.objectContaining({ invocation: spawned.invocation, status: "succeeded", answer: { state: "available", text: "Goal is healthy" } })] as InvocationObservation[]));
  });

  it("rejects an invalid or out-of-scope tool without invoking its executor", async () => {
    const modelGateway = gateway();
    const execute = vi.fn();
    const tools = new ToolRegistry();
    tools.register({ name: "readGoal", version: "1", description: "Read Goal", inputSchema: { parse: () => { throw new Error("invalid"); } }, outputSchema: { parse: (value: unknown) => value }, modelInputSchema: {}, allowsParallel: false, outboundDataClass: "public", execute });
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools });
    const spawned = await runtime.spawn({ name: "controller", modelPolicy: ["fake/model-a"], idempotencyKey: "root-2", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant: { ...grant, allowedTools: [] } });
    await runtime.prompt(spawned.execution, "show the Goal");
    expect(execute).not.toHaveBeenCalled();
    expect(await runtime.getInvocationStatus(spawned.invocation)).toBe("failed");
  });
});
