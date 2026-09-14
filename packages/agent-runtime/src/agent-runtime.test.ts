import { describe, expect, it, vi } from "vitest";
import type { InvocationObservation, ModelIdentity } from "@maestro/domain";
import type { GatewayBinding, ModelGatewayPort, ModelTurnResult, TurnLimits } from "./model-provider.js";
import { createMaestroAgentRuntime, ToolRegistry } from "./agent-runtime.js";
import { createIpPythonTool, deriveIpPythonToolCallCommandId } from "./ipython-tool.js";

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
  it("derives IPython effect command identity from the admission, turn, and tool call", async () => {
    const requests: unknown[] = [];
    let calls = 0;
    const modelGateway: ModelGatewayPort = {
      async listModels() { return []; },
      async admit() { return binding; },
      async turn(request): Promise<ModelTurnResult> {
        calls += 1;
        if (calls === 1) return { requestId: request.requestId, model: identity, text: "", toolCalls: [{ id: "ipython-call-1", name: "ipython", arguments: { state: "valid", value: { code: "print('ok')" } } }], stopReason: "tool_use", usage: { state: "unknown" } };
        return { requestId: request.requestId, model: identity, text: "done", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
      },
      async cancel() { return { state: "confirmed" as const }; },
      async recover() { return "reconnected" as const; },
      async close() {},
    };
    const sessions = {
      async execute(request: unknown) { requests.push(request); return { state: "ok" as const, dataClass: "workspace" as const, content: "ok" }; },
      async interrupt() {},
      async close() {},
    };
    const tools = new ToolRegistry();
    tools.register(createIpPythonTool({ sessions }));
    const ipythonGrant = { ...grant, allowedTools: ["ipython"], outboundDataClasses: ["workspace"], pathScope: ["/workspace"] } as const;
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools });
    const spawned = await runtime.spawn({ name: "worker", modelPolicy: ["fake/model-a"], idempotencyKey: "worker-admission-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1", authorityPolicyVersion: 1, controlEpoch: "epoch-1", budgetEffectCents: 0 }, grant: ipythonGrant });
    await runtime.prompt(spawned.execution, "run the Python tool");

    const request = requests[0] as { binding: { commandId: string; admissionCommandId?: string; toolCallId: string }; };
    const expected = deriveIpPythonToolCallCommandId("worker-admission-1", `${spawned.invocation}-turn-1`, "ipython-call-1");
    expect(request.binding.commandId).toBe(expected);
    expect(request.binding.admissionCommandId).toBe("worker-admission-1");
    expect(request.binding.toolCallId).toBe("ipython-call-1");
  });
  it("executes only registered tools with host-owned context and bounded continuation", async () => {
    const modelGateway = gateway();
    const execute = vi.fn(async (args: unknown, context: { projectId: string; goalId: string }) => ({ status: "ok" as const, content: JSON.stringify({ projectId: context.projectId, goalId: context.goalId, args }) }));
    const tools = new ToolRegistry();
    tools.register({ name: "readGoal", version: "1", description: "Read Goal", inputSchema: { parse: (value: unknown) => value }, outputSchema: { parse: (value: unknown) => value }, modelInputSchema: { type: "object" }, allowsParallel: false, outboundDataClass: "public", execute });
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools });
    const spawned = await runtime.spawn({ name: "controller", modelPolicy: ["fake/model-a"], idempotencyKey: "root-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant });
    await runtime.prompt(spawned.execution, "show the Goal");

    expect(execute).toHaveBeenCalledWith({ goalId: "wrong-goal" }, expect.objectContaining({ operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", commandId: "root-1", toolCallId: "call-1", sessionId: expect.stringContaining("session-") }));
    expect(modelGateway.calls).toBe(2);
    expect((await runtime.getInvocationStatus(spawned.invocation))).toBe("succeeded");
    expect((await runtime.getModelIdentity(spawned.execution))).toEqual(identity);
    expect((await runtime.observe(spawned.execution))).toEqual(expect.arrayContaining([expect.objectContaining({ invocation: spawned.invocation, status: "succeeded", answer: { state: "available", text: "Goal is healthy" } })] as InvocationObservation[]));
  });



  it("keeps confirmed cancellation terminal when the provider resolves after abort", async () => {
    let resolveTurn: ((result: ModelTurnResult) => void) | undefined;
    let cancelCalled = false;
    const modelGateway: ModelGatewayPort = {
      async listModels() { return []; },
      async admit() { return binding; },
      async turn(request): Promise<ModelTurnResult> {
        return new Promise((resolve) => {
          resolveTurn = resolve;
          request.signal.addEventListener("abort", () => undefined, { once: true });
        });
      },
      async cancel() { cancelCalled = true; return { state: "confirmed" as const }; },
      async recover() { return "reconnected" as const; },
      async close() {},
    };
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools: new ToolRegistry() });
    const spawned = await runtime.spawn({ name: "controller", modelPolicy: ["fake/model-a"], idempotencyKey: "cancel-race-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant });
    const prompt = runtime.prompt(spawned.execution, "hello");
    await Promise.resolve();
    await expect(runtime.cancel(spawned.invocation)).resolves.toEqual({ cancelled: true });
    expect(cancelCalled).toBe(true);
    resolveTurn?.({ requestId: "late", model: identity, text: "late success", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } });
    await prompt;

    await expect(runtime.getInvocationStatus(spawned.invocation)).resolves.toBe("cancelled");
  });

  it("forwards provider stream events with the host-owned turn identity", async () => {
    const events: Array<{ turnId: string; kind: string }> = [];
    const modelGateway: ModelGatewayPort = {
      async listModels() { return []; },
      async admit() { return binding; },
      async turn(request): Promise<ModelTurnResult> {
        request.emit({ kind: "text-delta", cursor: 1, text: "Hello" });
        return { requestId: request.requestId, model: identity, text: "Hello", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
      },
      async cancel() { return { state: "confirmed" as const }; },
      async recover() { return "reconnected" as const; },
      async close() {},
    };
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools: new ToolRegistry(), onModelEvent: (event, turnId) => events.push({ turnId, kind: event.kind }) });
    const spawned = await runtime.spawn({ name: "controller", modelPolicy: ["fake/model-a"], idempotencyKey: "stream-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant });
    await runtime.prompt(spawned.execution, "hello");

    expect(events).toEqual([{ turnId: expect.stringContaining(`${spawned.invocation}-turn-1`), kind: "text-delta" }]);
  });

  it("retains prior user and assistant messages across turns", async () => {
    const requests: Array<readonly { role: string }[]> = [];
    let calls = 0;
    const modelGateway: ModelGatewayPort = {
      async listModels() { return []; },
      async admit() { return binding; },
      async turn(request): Promise<ModelTurnResult> {
        requests.push(request.messages.map((message) => ({ role: message.role })));
        calls += 1;
        return { requestId: request.requestId, model: identity, text: calls === 1 ? "first answer" : "second answer", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
      },
      async cancel() { return { state: "confirmed" as const }; },
      async recover() { return "reconnected" as const; },
      async close() {},
    };
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools: new ToolRegistry() });
    const spawned = await runtime.spawn({ name: "conversation", modelPolicy: ["fake/model-a"], idempotencyKey: "history-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant });

    await runtime.prompt(spawned.execution, "first question");
    await runtime.prompt(spawned.execution, "second question");

    expect(requests).toEqual([[{ role: "user" }], [{ role: "user" }, { role: "assistant" }, { role: "user" }]]);
    await expect(runtime.getInvocationStatus(spawned.invocation)).resolves.toBe("succeeded");
  });

  it("accumulates streamed text when the provider result omits full text", async () => {
    const modelGateway: ModelGatewayPort = {
      async listModels() { return []; },
      async admit() { return binding; },
      async turn(request): Promise<ModelTurnResult> {
        request.emit({ kind: "text-delta", cursor: 1, text: "Hello " });
        request.emit({ kind: "text-delta", cursor: 2, text: "world" });
        return { requestId: request.requestId, model: identity, text: "", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
      },
      async cancel() { return { state: "confirmed" as const }; },
      async recover() { return "reconnected" as const; },
      async close() {},
    };
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools: new ToolRegistry() });
    const spawned = await runtime.spawn({ name: "controller", modelPolicy: ["fake/model-a"], idempotencyKey: "stream-aggregate-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant });
    await runtime.prompt(spawned.execution, "hello");

    await expect(runtime.observe(spawned.execution)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ invocation: spawned.invocation, answer: { state: "available", text: "Hello world" } }),
    ] as InvocationObservation[]));
  });

  it("fails closed when cumulative streamed output exceeds the turn bound", async () => {
    const modelGateway: ModelGatewayPort = {
      async listModels() { return []; },
      async admit() { return binding; },
      async turn(request): Promise<ModelTurnResult> {
        request.emit({ kind: "text-delta", cursor: 1, text: "a".repeat(60_000) });
        request.emit({ kind: "text-delta", cursor: 2, text: "b".repeat(10_000) });
        return { requestId: request.requestId, model: identity, text: "provider result", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
      },
      async cancel() { return { state: "confirmed" as const }; },
      async recover() { return "reconnected" as const; },
      async close() {},
    };
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools: new ToolRegistry() });
    const spawned = await runtime.spawn({ name: "bounded", modelPolicy: ["fake/model-a"], idempotencyKey: "bounded-output-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant });

    await runtime.prompt(spawned.execution, "hello");
    const observation = (await runtime.observe(spawned.execution)).find((item) => item.invocation === spawned.invocation);

    expect(observation?.status).toBe("failed");
    expect(observation?.error).toBe("model output limit exceeded");
    expect(observation?.answer.state === "available" && Buffer.byteLength(observation.answer.text, "utf8")).toBeLessThanOrEqual(64_000);
  });

  it("fails closed when a child widens any non-tool grant or changes Goal identity", async () => {
    const runtime = createMaestroAgentRuntime({ gateway: gateway(), binding, tools: new ToolRegistry() });
    const parentContext = { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1", accountRef: "account-1", authorityPolicyVersion: 2, controlEpoch: "epoch-1", budgetEffectCents: 0 };
    const parentGrant = { ...grant, grantId: "parent-grant", allowedSkills: ["skill-a"], pathScope: ["repo"], outboundDataClasses: ["public", "workspace"], remaining: { ...grant.remaining, childCalls: 2, modelTurns: 3, toolCalls: 2, outputTokens: 128, wallTimeMs: 10_000, retryCount: 1 } };
    const root = await runtime.spawn({ name: "parent", modelPolicy: ["fake/model-a"], idempotencyKey: "parent-1", context: parentContext, grant: parentGrant });

    await expect(runtime.spawn({
      name: "child",
      parent: root.execution,
      prompt: "child prompt",
      modelPolicy: ["fake/model-a"],
      idempotencyKey: "child-1",
      context: { ...parentContext, goalId: "goal-2" },
      grant: {
        ...parentGrant,
        grantId: "child-grant",
        parentGrantId: parentGrant.grantId,
        allowedSkills: ["skill-a", "skill-b"],
        pathScope: ["repo", "outside-repo"],
        outboundDataClasses: ["public", "workspace", "secret"],
        remaining: { ...parentGrant.remaining, modelTurns: 4, toolCalls: 2, childCalls: 1, outputTokens: 129, wallTimeMs: 10_001, retryCount: 2 },
      },
    })).rejects.toThrow("child grant widens parent capability");
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

  it("bounds every wire-validated turn limit to the real Model Gateway schema for an oversized domain grant", async () => {
    // A real Mission Bundle timeCeiling of days/hours produces a
    // correspondingly large grant.remaining.wallTimeMs (see
    // packages/persistence/src/worker.ts's missionTimeLimitMs), and nothing
    // in packages/domain/src/mission-bundle.ts bounds allowedTools.length or
    // workerCeiling either, so grant.remaining.toolCalls/childCalls can also
    // exceed the gateway's own caps. The Model Gateway's real wire schema
    // (apps/model-gateway/src/rpc.ts's LimitsSchema) caps every one of these
    // fields; sending an unclamped value through a real gateway process
    // fails schema validation and durably strands the invocation as
    // "unknown" with an opaque "invalid model turn request" -- this is a
    // real defect this test reproduces and pins closed.
    let received: TurnLimits | undefined;
    const modelGateway: ModelGatewayPort = {
      async listModels() { return []; },
      async admit() { return binding; },
      async turn(request) {
        received = request.limits;
        return { requestId: request.requestId, model: identity, text: "ok", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
      },
      async cancel() { return { state: "confirmed" as const }; },
      async recover() { return "reconnected" as const; },
      async close() {},
    };
    const oversizedGrant = { ...grant, remaining: { ...grant.remaining, modelTurns: 500, toolCalls: 5_000, childCalls: 500, outputTokens: 5_000_000, wallTimeMs: 3 * 24 * 60 * 60 * 1000 } };
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools: new ToolRegistry() });
    const spawned = await runtime.spawn({ name: "oversized-grant", modelPolicy: ["fake/model-a"], idempotencyKey: "oversized-grant-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant: oversizedGrant });
    await runtime.prompt(spawned.execution, "return a bounded result");

    expect(received).toBeDefined();
    expect(received!.maxModelTurns).toBeLessThanOrEqual(100);
    expect(received!.maxToolCalls).toBeLessThanOrEqual(1_000);
    expect(received!.maxChildCalls).toBeLessThanOrEqual(100);
    expect(received!.maxOutputTokens).toBeLessThanOrEqual(1_000_000);
    expect(received!.providerTimeoutMs).toBeLessThanOrEqual(600_000);
    expect(received!.wallTimeMs).toBeLessThanOrEqual(3_600_000);
    expect(await runtime.getInvocationStatus(spawned.invocation)).toBe("succeeded");
  });

  it("bounds the wire messages array to 128 entries for a long conversation well under the byte budget", async () => {
    // apps/model-gateway/src/rpc.ts's TurnSchema caps `messages` at 128
    // array entries independent of their combined byte size. A real
    // conversation (apps/control-plane/src/conversation-service.ts replays
    // every durable conversation_turns row with no row-count limit) can
    // realistically accumulate more than 128 short exchanges while staying
    // well under the 64_000-byte budget -- this is a real defect this test
    // reproduces and pins closed.
    let receivedMessageCount: number | undefined;
    const modelGateway: ModelGatewayPort = {
      async listModels() { return []; },
      async admit() { return binding; },
      async turn(request) {
        receivedMessageCount = request.messages.length;
        return { requestId: request.requestId, model: identity, text: "ok", toolCalls: [], stopReason: "end_turn", usage: { state: "unknown" } };
      },
      async cancel() { return { state: "confirmed" as const }; },
      async recover() { return "reconnected" as const; },
      async close() {},
    };
    const longHistory = Array.from({ length: 200 }, (_, index) => ({ role: "user" as const, content: [{ kind: "text" as const, text: `message ${index}` }] }));
    const runtime = createMaestroAgentRuntime({ gateway: modelGateway, binding, tools: new ToolRegistry(), initialMessages: longHistory });
    const spawned = await runtime.spawn({ name: "long-conversation", modelPolicy: ["fake/model-a"], idempotencyKey: "long-conversation-1", context: { operatorId: "operator-1", projectId: "project-1", goalId: "goal-1", missionBundleId: "bundle-1", policyVersion: "policy-1" }, grant });
    await runtime.prompt(spawned.execution, "continue the conversation");

    expect(receivedMessageCount).toBeDefined();
    expect(receivedMessageCount!).toBeLessThanOrEqual(128);
    expect(await runtime.getInvocationStatus(spawned.invocation)).toBe("succeeded");
  });
});
