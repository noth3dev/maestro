import {
  type CapabilityGrant,
  type ExecutionRef,
  type InvocationAnswer,
  type InvocationContext,
  type InvocationRef,
  type InvocationStatus,
  type InvocationUsage,
  type WorkerProfileAssignment,
} from "@maestro/domain";
import type { ModelMessage } from "../model-provider.js";

export interface RuntimeRecord {
  readonly execution: ExecutionRef;
  readonly invocation: InvocationRef;
  readonly name: string;
  readonly context: InvocationContext;
  readonly grant: CapabilityGrant;
  readonly modelPolicy: readonly string[];
  readonly idempotencyKey: string;
  readonly workerProfile?: WorkerProfileAssignment;
  readonly systemPrompt?: string;
  readonly parent?: InvocationRef;
  released: boolean;
  readonly sessionId: string;
  readonly messages: ModelMessage[];
  readonly toolEvents: import("@maestro/domain").ToolEvent[];
  readonly abort: AbortController;
  status: InvocationStatus;
  phase: "queued" | "provider_turn" | "tool_executing" | "terminal";
  model?: import("@maestro/domain").ModelIdentity;
  usage: InvocationUsage;
  answer: InvocationAnswer;
  error?: string;
  turnCount: number;
  toolCount: number;
  activeRequestId: string | undefined;
  sessionVersion: number;
  lastCursor: number;
  modelCursor: number;
}

// The Model Gateway's real wire schema (apps/model-gateway/src/rpc.ts's
// LimitsSchema) caps every one of these fields. Every value here is
// ultimately domain-derived -- a Mission Bundle's timeCeiling is a
// multi-day budget (packages/persistence/src/worker.ts's
// missionTimeLimitMs), and nothing in packages/domain/src/mission-bundle.ts
// bounds allowedTools.length or workerCeiling against the gateway's own
// maxToolCalls/maxChildCalls ceilings either. Sending any unclamped value
// fails real gateway schema validation and durably strands the invocation
// as an opaque "unknown" -- clamp every field defensively so a Mission
// Bundle author's otherwise-legitimate choice can never silently break
// every real turn against the actual wire boundary.
export const MAX_WIRE_MODEL_TURNS = 100;
export const MAX_WIRE_TOOL_CALLS = 1_000;
export const MAX_WIRE_CHILD_CALLS = 100;
export const MAX_WIRE_OUTPUT_TOKENS = 1_000_000;
export const MAX_WIRE_PROVIDER_TIMEOUT_MS = 600_000;
export const MAX_WIRE_WALL_TIME_MS = 3_600_000;
// TurnSchema also caps the messages and tools arrays themselves at 128
// entries each (independent of their combined byte size). A long-running
// conversation (packages/persistence's conversation_turns has no row-count
// limit) or a Mission Bundle with many allowedTools can realistically
// exceed 128 items while staying well under the byte budget below.
export const MAX_WIRE_MESSAGE_COUNT = 128;
export const MAX_WIRE_TOOL_DEFINITIONS = 128;
