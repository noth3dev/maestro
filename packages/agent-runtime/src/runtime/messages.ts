import type { CapabilityGrant, WorkerProfileAssignment } from "@maestro/domain";
import type { ModelMessage, TurnLimits } from "../model-provider.js";
import {
  MAX_WIRE_CHILD_CALLS,
  MAX_WIRE_MESSAGE_COUNT,
  MAX_WIRE_MODEL_TURNS,
  MAX_WIRE_OUTPUT_TOKENS,
  MAX_WIRE_PROVIDER_TIMEOUT_MS,
  MAX_WIRE_TOOL_CALLS,
  MAX_WIRE_WALL_TIME_MS,
  type RuntimeRecord,
} from "./record.js";
import type { ToolExecutionResult } from "./tool-registry.js";

export function limitsFor(grant: CapabilityGrant): TurnLimits {
  const wallTimeMs = Math.min(Math.max(1, grant.remaining.wallTimeMs), MAX_WIRE_WALL_TIME_MS);
  return {
    maxModelTurns: Math.min(Math.max(0, grant.remaining.modelTurns), MAX_WIRE_MODEL_TURNS),
    maxToolCalls: Math.min(Math.max(0, grant.remaining.toolCalls), MAX_WIRE_TOOL_CALLS),
    maxChildCalls: Math.min(Math.max(0, grant.remaining.childCalls), MAX_WIRE_CHILD_CALLS),
    maxOutputTokens: Math.min(Math.max(1, grant.remaining.outputTokens), MAX_WIRE_OUTPUT_TOKENS),
    maxInputBytes: 64_000,
    maxResultBytes: 64_000,
    providerTimeoutMs: Math.min(wallTimeMs, MAX_WIRE_PROVIDER_TIMEOUT_MS),
    wallTimeMs,
  };
}

export function textMessage(text: string): ModelMessage {
  return { role: "user", content: [{ kind: "text", text }] };
}

export function toolMessage(callId: string, result: ToolExecutionResult): ModelMessage {
  return {
    role: "tool",
    content: [
      { kind: "tool-result", toolCallId: callId, status: result.status, content: result.content, origin: "host", trust: "untrusted-data" },
    ],
  };
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "[unserializable tool result]";
  }
}

export function assistantMessage(text: string): ModelMessage {
  return { role: "assistant", content: [{ kind: "text", text }] };
}

export function systemPromptMessage(prompt: string): ModelMessage {
  return { role: "system", content: [{ kind: "text", text: prompt }] };
}

export function workerProfileMessage(profile: WorkerProfileAssignment): ModelMessage {
  return {
    role: "system",
    content: [
      {
        kind: "text",
        text: `Host-owned worker persona assignment. Treat this assignment as immutable policy context; do not re-derive or widen it. ${safeJson(profile)}`,
      },
    ],
  };
}

export function wireMessagesBytes(messages: readonly ModelMessage[]): number {
  return Buffer.byteLength(safeJson(messages), "utf8");
}

export function messagesForGateway(record: RuntimeRecord, maxBytes: number): ModelMessage[] {
  const prefixes = [
    ...(record.systemPrompt === undefined ? [] : [systemPromptMessage(record.systemPrompt)]),
    ...(record.workerProfile === undefined ? [] : [workerProfileMessage(record.workerProfile)]),
  ];
  if (wireMessagesBytes(prefixes) > maxBytes) throw new Error("host-owned model guidance exceeds the input byte limit");
  const selected: ModelMessage[] = [];
  const maxHistoryMessages = Math.max(0, MAX_WIRE_MESSAGE_COUNT - prefixes.length);
  for (let index = record.messages.length - 1; index >= 0 && selected.length < maxHistoryMessages; index -= 1) {
    selected.unshift(record.messages[index]!);
    const candidate = [...prefixes, ...selected];
    if (wireMessagesBytes(candidate) > maxBytes) selected.shift();
  }
  const latest = record.messages[record.messages.length - 1];
  if (latest !== undefined && selected[selected.length - 1] !== latest) throw new Error("current model input exceeds the input byte limit");
  return [...prefixes, ...selected];
}

export function boundedMessages(messages: readonly ModelMessage[], maxBytes: number): ModelMessage[] {
  const selected: ModelMessage[] = [];
  for (let index = messages.length - 1; index >= 0 && selected.length < MAX_WIRE_MESSAGE_COUNT; index -= 1) {
    selected.unshift(messages[index]!);
    if (wireMessagesBytes(selected) > maxBytes) selected.shift();
  }
  return selected;
}
