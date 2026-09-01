declare const executionRefBrand: unique symbol;
declare const invocationRefBrand: unique symbol;
declare const toolEventRefBrand: unique symbol;

/** Opaque Maestro references. Provider identifiers never cross this boundary. */
export type ExecutionRef = string & { readonly [executionRefBrand]: "ExecutionRef" };
export type InvocationRef = string & { readonly [invocationRefBrand]: "InvocationRef" };
export type ToolEventRef = string & { readonly [toolEventRefBrand]: "ToolEventRef" };

/** `unknown` means no provider state or terminal evidence is available. */
export type InvocationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export interface SpawnRequest {
  name: string;
  cwd?: string;
  parent?: ExecutionRef;
  prompt?: string;
}

export interface SpawnedInvocation {
  execution: ExecutionRef;
  invocation: InvocationRef;
}

/** A normalized, provider-independent indication of current tool activity. */
export interface ToolActivityEvent {
  ref: ToolEventRef;
  kind: "activity";
  state: "waiting" | "writing" | "executing";
  toolName?: string;
}

export type ToolEvent = ToolActivityEvent;

/** `empty` means the provider reported no events; `unavailable` means events cannot be observed. */
export type ToolEvents =
  | { state: "available"; events: readonly ToolEvent[] }
  | { state: "empty"; events: readonly [] }
  | { state: "unavailable"; reason: "provider-does-not-expose-tool-events" | "snapshot-unavailable" };

/** `unknown` means the provider exposed a snapshot but not a token count. */
export type InvocationUsage =
  | { state: "available"; totalTokens: number }
  | { state: "unknown" }
  | { state: "unavailable"; reason: "provider-does-not-expose-usage" | "snapshot-unavailable" };

/**
 * `unavailable` means the provider completed the invocation but this kernel
 * cannot observe its final reply text through the bound provider surface.
 * This must never be fabricated; an absent or empty string is not the same
 * as a genuinely observed empty reply.
 */
export type InvocationAnswer =
  | { state: "available"; text: string }
  | { state: "unavailable"; reason: "provider-does-not-expose-answer-text" | "snapshot-unavailable" };

export interface InvocationObservation {
  invocation: InvocationRef;
  name: string;
  status: InvocationStatus;
  toolEvents: ToolEvents;
  usage: InvocationUsage;
  answer: InvocationAnswer;
  error?: string;
}

export interface ModelIdentity {
  provider: string;
  id: string;
}

export class ExecutionKernelUnavailableError extends Error {
  readonly code = "EXECUTION_KERNEL_UNAVAILABLE";

  constructor(readonly operation: "resume" | "reconnect" | "prompt" | "sendMessage" | "getModelIdentity") {
    super(`Execution kernel operation unavailable: ${operation}`);
    this.name = "ExecutionKernelUnavailableError";
  }
}

export interface ExecutionKernelPort {
  spawn(request: SpawnRequest): Promise<SpawnedInvocation>;
  prompt(execution: ExecutionRef, text: string): Promise<void>;
  observe(execution: ExecutionRef): Promise<readonly InvocationObservation[]>;
  sendMessage(execution: ExecutionRef, invocation: InvocationRef, message: string): Promise<void>;
  cancel(invocation: InvocationRef): Promise<{ cancelled: boolean }>;
  getModelIdentity(execution: ExecutionRef): Promise<ModelIdentity>;
  getToolEvents(invocation: InvocationRef): Promise<ToolEvents>;
  getUsage(invocation: InvocationRef): Promise<InvocationUsage>;
  getInvocationStatus(invocation: InvocationRef): Promise<InvocationStatus>;
  resume(execution: ExecutionRef): Promise<never>;
  reconnect(execution: ExecutionRef): Promise<never>;
}
