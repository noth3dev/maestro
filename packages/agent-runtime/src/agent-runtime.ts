import { randomUUID } from "node:crypto";
import { ExecutionKernelUnavailableError, type CapabilityGrant, type ExecutionKernelPort, type ExecutionRef, type InvocationAnswer, type InvocationContext, type InvocationObservation, type InvocationRef, type InvocationStatus, type InvocationUsage, type ModelIdentity, type SpawnRequest, type SpawnedInvocation, type ToolEvent, type ToolEvents } from "@maestro/domain";
import { formatModelRef, type GatewayBinding, type ModelGatewayPort, type ModelMessage, type ModelStreamEvent, type ModelToolCall, type ModelToolDefinition, type ToolResultStatus, type TurnLimits } from "./model-provider.js";

export interface ToolContext extends InvocationContext {
  readonly conversationId: string;
  readonly turnId: string;
  readonly sessionVersion: number;
  readonly controllerPolicyHash: string;
  readonly capabilityGrant: CapabilityGrant;
  readonly outboundDataPolicyHash: string;
}

export interface ToolExecutionResult {
  readonly status: ToolResultStatus;
  readonly content: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: { parse(value: unknown): unknown };
  readonly outputSchema: { parse(value: unknown): unknown };
  readonly modelInputSchema: unknown;
  readonly allowsParallel: boolean;
  readonly outboundDataClass: "public" | "workspace" | "private" | "pii" | "phi" | "secret";
  execute(args: unknown, context: ToolContext): Promise<ToolExecutionResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) throw new Error("duplicate tool name");
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }

  definitions(allowedTools: readonly string[]): readonly ModelToolDefinition[] {
    return allowedTools.flatMap((name) => {
      const tool = this.tools.get(name);
      if (tool === undefined) return [];
      return [{ name: tool.name, version: tool.version, description: tool.description, inputSchema: tool.modelInputSchema, outputSchema: {}, allowsParallel: tool.allowsParallel, outboundDataClass: tool.outboundDataClass }];
    });
  }

  async execute(call: ModelToolCall, context: ToolContext): Promise<ToolExecutionResult> {
    const tool = this.tools.get(call.name);
    if (tool === undefined) throw new Error("tool is not registered");
    if (call.arguments.state !== "valid") throw new Error("tool arguments are invalid");
    const parsed = tool.inputSchema.parse(call.arguments.value);
    const result = await tool.execute(parsed, context);
    tool.outputSchema.parse(result);
    return result;
  }
}

interface RuntimeRecord {
  readonly execution: ExecutionRef;
  readonly invocation: InvocationRef;
  readonly name: string;
  readonly context: InvocationContext;
  readonly grant: CapabilityGrant;
  readonly modelPolicy: readonly string[];
  readonly idempotencyKey: string;
  readonly parent?: InvocationRef;
  readonly sessionId: string;
  readonly messages: ModelMessage[];
  readonly toolEvents: ToolEvent[];
  readonly abort: AbortController;
  status: InvocationStatus;
  phase: "queued" | "provider_turn" | "tool_executing" | "terminal";
  model?: ModelIdentity;
  usage: InvocationUsage;
  answer: InvocationAnswer;
  error?: string;
  turnCount: number;
  toolCount: number;
  activeRequestId: string | undefined;
  sessionVersion: number;
  lastCursor: number;
}

export interface MaestroAgentRuntime extends ExecutionKernelPort {
  /** Test-only read of the host-owned grant; never exposed through HTTP/API contracts. */
  inspectGrantForTest(invocation: InvocationRef): CapabilityGrant;
}

const asExecution = (value: string): ExecutionRef => value as ExecutionRef;
const asInvocation = (value: string): InvocationRef => value as InvocationRef;
const asToolEvent = (value: string): ToolEvent["ref"] => value as ToolEvent["ref"];
const defaultUsage: InvocationUsage = { state: "unknown" };
const defaultAnswer: InvocationAnswer = { state: "unavailable", reason: "snapshot-unavailable" };

// The Model Gateway's real wire schema (apps/model-gateway/src/rpc.ts's
// TurnSchema) caps providerTimeoutMs at 600_000ms and wallTimeMs at
// 3_600_000ms. A Mission Bundle's timeCeiling is a multi-day domain-level
// budget (packages/persistence/src/worker.ts's missionTimeLimitMs), so
// grant.remaining.wallTimeMs commonly exceeds both wire ceilings. Sending an
// unclamped value fails real gateway schema validation and durably strands
// the invocation as "unknown" -- clamp defensively rather than let a
// Mission Bundle author's time ceiling silently break every real turn.
const MAX_WIRE_PROVIDER_TIMEOUT_MS = 600_000;
const MAX_WIRE_WALL_TIME_MS = 3_600_000;

function limitsFor(grant: CapabilityGrant): TurnLimits {
  const wallTimeMs = Math.min(Math.max(1, grant.remaining.wallTimeMs), MAX_WIRE_WALL_TIME_MS);
  return { maxModelTurns: grant.remaining.modelTurns, maxToolCalls: grant.remaining.toolCalls, maxChildCalls: grant.remaining.childCalls, maxOutputTokens: grant.remaining.outputTokens, maxInputBytes: 64_000, maxResultBytes: 64_000, providerTimeoutMs: Math.min(wallTimeMs, MAX_WIRE_PROVIDER_TIMEOUT_MS), wallTimeMs };
}

function textMessage(text: string): ModelMessage { return { role: "user", content: [{ kind: "text", text }] }; }
function toolMessage(callId: string, result: ToolExecutionResult): ModelMessage { return { role: "tool", content: [{ kind: "tool-result", toolCallId: callId, status: result.status, content: result.content, origin: "host", trust: "untrusted-data" }] }; }
function safeJson(value: unknown): string { try { return JSON.stringify(value) ?? "null"; } catch { return "[unserializable tool result]"; } }
function assistantMessage(text: string): ModelMessage { return { role: "assistant", content: [{ kind: "text", text }] }; }
function messageBytes(message: ModelMessage): number { return Buffer.byteLength(safeJson(message.content), "utf8"); }
function boundedMessages(messages: readonly ModelMessage[], maxBytes: number): ModelMessage[] {
  const kept: ModelMessage[] = [];
  let bytes = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const size = messageBytes(message);
    if (bytes + size > maxBytes) continue;
    kept.push(message);
    bytes += size;
  }
  return kept.reverse();
}

export function createMaestroAgentRuntime(options: { gateway: ModelGatewayPort; binding: GatewayBinding; tools: ToolRegistry; initialMessages?: readonly ModelMessage[]; onModelEvent?: (event: ModelStreamEvent, turnId: string) => void; closeGateway?: boolean }): MaestroAgentRuntime {
  const records = new Map<InvocationRef, RuntimeRecord>();
  const byExecution = new Map<ExecutionRef, InvocationRef>();
  let closing = false;

  function rootForExecution(execution: ExecutionRef): RuntimeRecord | undefined {
    const invocation = byExecution.get(execution);
    return invocation === undefined ? undefined : records.get(invocation);
  }

  function requireRecord(invocation: InvocationRef): RuntimeRecord {
    const record = records.get(invocation);
    if (record === undefined) throw new Error("unknown invocation");
    return record;
  }

  function appendToolEvent(record: RuntimeRecord, event: Omit<ToolEvent, "ref" | "kind">): void {
    record.lastCursor += 1;
    record.toolEvents.push({ ref: asToolEvent(`tool-event-${record.invocation}-${record.lastCursor}`), kind: "activity", ...event });
  }

  function validateAdmission(request: SpawnRequest): { context: InvocationContext; grant: CapabilityGrant; modelPolicy: readonly string[]; idempotencyKey: string } {
    if (request.context === undefined || request.grant === undefined || request.modelPolicy === undefined || request.idempotencyKey === undefined) throw new Error("native invocation requires host-owned context, grant, model policy, and idempotency key");
    if (request.modelPolicy.length !== 1 || request.modelPolicy[0] !== formatModelRef(options.binding.provider)) throw new Error("native invocation model is not bound to the gateway model");
    if (request.grant.modelPolicy.length !== 1 || request.grant.modelPolicy[0] !== request.modelPolicy[0]) throw new Error("native invocation grant model policy mismatch");
    if (request.context.accountRef !== undefined && request.context.accountRef !== options.binding.account.accountRef) throw new Error("native invocation account binding mismatch");
    return { context: request.context, grant: request.grant, modelPolicy: request.modelPolicy, idempotencyKey: request.idempotencyKey };
  }

  async function executeTurn(record: RuntimeRecord, text?: string): Promise<void> {
    if (record.abort.signal.aborted || (record.phase === "terminal" && record.status !== "succeeded")) return;
    if (text !== undefined) record.messages.push(textMessage(text));
    record.status = "running";
    record.phase = "provider_turn";
    record.answer = defaultAnswer;
    for (;;) {
      if (record.abort.signal.aborted) { record.status = "cancelled"; record.phase = "terminal"; return; }
      if (record.turnCount >= record.grant.remaining.modelTurns) { record.status = "failed"; record.error = "model turn limit exceeded"; record.phase = "terminal"; return; }
      record.turnCount += 1;
      const requestId = `${record.invocation}-turn-${record.turnCount}`;
      record.activeRequestId = requestId;
      record.phase = "provider_turn";
      let result;
      let streamedText = "";
      let streamedBytes = 0;
      let streamExceeded = false;
      const turnLimits = limitsFor(record.grant);
      try {
        result = await options.gateway.turn({ binding: options.binding, requestId, sessionId: record.sessionId, turnId: `${record.invocation}-turn-${record.turnCount}`, messages: boundedMessages(record.messages, turnLimits.maxInputBytes), tools: options.tools.definitions(record.grant.allowedTools), limits: turnLimits, signal: record.abort.signal, emit: (event: ModelStreamEvent) => {
          if (event.kind !== "text-delta" || event.text === "") { options.onModelEvent?.(event, `${record.invocation}-turn-${record.turnCount}`); return; }
          const remaining = turnLimits.maxResultBytes - streamedBytes;
          if (remaining <= 0) { streamExceeded = true; record.abort.abort(); return; }
          let end = event.text.length;
          while (end > 0 && Buffer.byteLength(event.text.slice(0, end), "utf8") > remaining) end -= 1;
          if (end < event.text.length && end > 0) {
            const previous = event.text.charCodeAt(end - 1);
            const next = event.text.charCodeAt(end);
            if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
          }
          const bounded = event.text.slice(0, end);
          streamedText += bounded;
          streamedBytes += Buffer.byteLength(bounded, "utf8");
          record.answer = { state: "available", text: streamedText };
          if (bounded !== event.text) { streamExceeded = true; record.abort.abort(); }
          if (bounded !== "") options.onModelEvent?.(bounded === event.text ? event : { ...event, text: bounded }, `${record.invocation}-turn-${record.turnCount}`);
        } });
      } catch (error) {
        record.activeRequestId = undefined;
        record.phase = "terminal";
        if (streamExceeded) { record.status = "failed"; record.error = "model output limit exceeded"; return; }
        if (record.abort.signal.aborted) {
          if ((record.status as InvocationStatus) !== "cancelled" && (record.status as InvocationStatus) !== "unknown") { record.status = "unknown"; record.error = "provider cancellation outcome is unknown"; }
        } else { record.status = "unknown"; record.error = error instanceof Error ? error.message : "provider outcome is unknown"; }
        return;
      }
      record.activeRequestId = undefined;
      if (streamExceeded) { record.status = "failed"; record.error = "model output limit exceeded"; record.phase = "terminal"; return; }
      if (record.abort.signal.aborted) {
        if ((record.status as InvocationStatus) !== "cancelled") { record.status = "unknown"; record.error = "provider cancellation outcome is unknown"; }
        record.phase = "terminal";
        return;
      }
      if (Buffer.byteLength(result.text, "utf8") > turnLimits.maxResultBytes) { record.status = "failed"; record.error = "model output limit exceeded"; record.phase = "terminal"; return; }
      if (result.model.provider !== options.binding.provider.provider || result.model.id !== options.binding.provider.id) { record.status = "failed"; record.error = "provider model identity mismatch"; record.phase = "terminal"; return; }
      record.model = result.model; record.usage = result.usage;
      if (result.text) record.answer = { state: "available", text: result.text };
      const assistantText = result.text || streamedText;
      if (assistantText !== "") record.messages.push(assistantMessage(assistantText));
      if (result.toolCalls.length === 0) { record.status = "succeeded"; record.phase = "terminal"; return; }
      const seen = new Map<string, string>();
      for (const call of result.toolCalls) {
        const argsKey = safeJson(call.arguments);
        const prior = seen.get(call.id);
        if (prior !== undefined && prior !== argsKey) { record.status = "failed"; record.error = "tool call ID was reused with different arguments"; record.phase = "terminal"; return; }
        if (prior !== undefined) { record.status = "failed"; record.error = "duplicate tool call ID"; record.phase = "terminal"; return; }
        seen.set(call.id, argsKey);
        if (record.toolCount >= record.grant.remaining.toolCalls) { record.status = "failed"; record.error = "tool call limit exceeded"; record.phase = "terminal"; return; }
        record.toolCount += 1;
        const tool = options.tools.get(call.name);
        if (tool === undefined || !record.grant.allowedTools.includes(call.name)) { appendToolEvent(record, { state: "waiting", toolName: call.name }); record.status = "failed"; record.error = "tool is outside the invocation grant"; record.phase = "terminal"; return; }
        record.phase = "tool_executing"; appendToolEvent(record, { state: "executing", toolName: call.name });
        const context: ToolContext = { ...record.context, conversationId: record.sessionId, turnId: `${record.invocation}-turn-${record.turnCount}`, sessionVersion: record.sessionVersion, controllerPolicyHash: record.context.policyVersion, capabilityGrant: record.grant, outboundDataPolicyHash: options.binding.dataPolicyHash };
        let toolResult: ToolExecutionResult;
        try { toolResult = await options.tools.execute(call, context); }
        catch (error) { record.status = "failed"; record.error = error instanceof Error ? error.message : "tool execution failed"; record.phase = "terminal"; return; }
        appendToolEvent(record, { state: "waiting", toolName: call.name });
        record.messages.push({ role: "assistant", content: [{ kind: "tool-call", call }] });
        record.messages.push(toolMessage(call.id, { ...toolResult, content: toolResult.content.slice(0, limitsFor(record.grant).maxResultBytes) }));
      }
    }
  }

  const runtime: MaestroAgentRuntime = {
    async spawn(request): Promise<SpawnedInvocation> {
      if (closing) throw new Error("native runtime is shutting down");
      const admission = validateAdmission(request);
      if (request.parent !== undefined) {
        const parent = rootForExecution(request.parent);
        if (parent === undefined) throw new Error("unknown parent execution");
        if (!request.prompt) throw new Error("child invocation requires a prompt");
        if (parent.grant.remaining.childCalls <= 0) throw new Error("child call limit exceeded");
        const childGrant = admission.grant;
        if (childGrant.parentGrantId !== parent.grant.grantId || childGrant.remaining.childCalls > parent.grant.remaining.childCalls - 1 || childGrant.remaining.toolCalls > parent.grant.remaining.toolCalls || childGrant.allowedTools.some((tool) => !parent.grant.allowedTools.includes(tool))) throw new Error("child grant widens parent capability");
        parent.grant.remaining.childCalls -= 1;
        const invocation = asInvocation(`invocation-${randomUUID()}`);
        const record: RuntimeRecord = { execution: parent.execution, invocation, name: request.name, context: admission.context, grant: childGrant, modelPolicy: admission.modelPolicy, idempotencyKey: admission.idempotencyKey, parent: parent.invocation, sessionId: parent.sessionId, messages: [], toolEvents: [], abort: new AbortController(), status: "queued", phase: "queued", activeRequestId: undefined, usage: defaultUsage, answer: defaultAnswer, turnCount: 0, toolCount: 0, sessionVersion: 0, lastCursor: 0 };
        records.set(invocation, record);
        void executeTurn(record, request.prompt);
        return { execution: parent.execution, invocation };
      }
      const execution = asExecution(`execution-${randomUUID()}`);
      const invocation = asInvocation(`invocation-${randomUUID()}`);
      const record: RuntimeRecord = { execution, invocation, name: request.name, context: admission.context, grant: admission.grant, modelPolicy: admission.modelPolicy, idempotencyKey: admission.idempotencyKey, sessionId: `session-${randomUUID()}`, messages: boundedMessages(options.initialMessages ?? [], 64_000), toolEvents: [], abort: new AbortController(), status: "queued", phase: "queued", activeRequestId: undefined, usage: defaultUsage, answer: defaultAnswer, turnCount: 0, toolCount: 0, sessionVersion: 0, lastCursor: 0 };
      records.set(invocation, record); byExecution.set(execution, invocation);
      return { execution, invocation };
    },
    async prompt(execution, text) { const record = rootForExecution(execution); if (record === undefined) throw new ExecutionKernelUnavailableError("prompt"); await executeTurn(record, text); },
    async observe(execution): Promise<readonly InvocationObservation[]> {
      const root = rootForExecution(execution); if (root === undefined) return [];
      return [...records.values()].filter((record) => record.execution === execution).map((record) => ({ invocation: record.invocation, name: record.name, status: record.status, toolEvents: record.toolEvents.length === 0 ? { state: "empty", events: [] as const } : { state: "available", events: record.toolEvents }, usage: record.usage, answer: record.answer, ...(record.error === undefined ? {} : { error: record.error }) }));
    },
    async sendMessage(execution, invocation, message) { const record = records.get(invocation); if (record === undefined || record.execution !== execution) throw new Error("unknown invocation"); await executeTurn(record, message); },
    async cancel(invocation) {
      const record = requireRecord(invocation);
      if (record.phase === "terminal") return { cancelled: record.status === "cancelled" };
      record.abort.abort();
      if (record.activeRequestId !== undefined) {
        const outcome = await options.gateway.cancel(record.activeRequestId);
        if (outcome.state === "confirmed") { record.status = "cancelled"; record.phase = "terminal"; return { cancelled: true }; }
        record.status = "unknown"; record.error = "provider cancellation is not proven"; record.phase = "terminal"; return { cancelled: false };
      }
      record.status = "cancelled"; record.phase = "terminal"; return { cancelled: true };
    },
    async getModelIdentity(execution) { const record = rootForExecution(execution); if (record?.model === undefined) throw new ExecutionKernelUnavailableError("getModelIdentity"); return record.model; },
    async getToolEvents(invocation): Promise<ToolEvents> { const record = records.get(invocation); if (record === undefined) return { state: "unavailable", reason: "snapshot-unavailable" }; return record.toolEvents.length === 0 ? { state: "empty", events: [] } : { state: "available", events: record.toolEvents }; },
    async getUsage(invocation) { return records.get(invocation)?.usage ?? { state: "unavailable", reason: "snapshot-unavailable" }; },
    async getInvocationStatus(invocation) { return records.get(invocation)?.status ?? "unknown"; },
    async resume() { throw new ExecutionKernelUnavailableError("resume"); },
    async reconnect() { throw new ExecutionKernelUnavailableError("reconnect"); },
    async release(invocation) { records.delete(invocation); },
    async close() { closing = true; for (const record of records.values()) { if (record.phase !== "terminal") { record.abort.abort(); record.status = "unknown"; record.phase = "terminal"; } } if (options.closeGateway !== false) await options.gateway.close(); },
    inspectGrantForTest(invocation) { return requireRecord(invocation).grant; },
  };
  return runtime;
}

