declare const executionRefBrand: unique symbol;
declare const invocationRefBrand: unique symbol;
declare const toolEventRefBrand: unique symbol;

/** Opaque Maestro references. Canonical provider/model identity is carried separately as validated evidence. */
export type ExecutionRef = string & { readonly [executionRefBrand]: "ExecutionRef" };
export type InvocationRef = string & { readonly [invocationRefBrand]: "InvocationRef" };
export type ToolEventRef = string & { readonly [toolEventRefBrand]: "ToolEventRef" };

/** Convert a non-empty persisted/provider execution identifier at the boundary. */
export function toExecutionRef(value: string): ExecutionRef {
  if (value.trim() === "") throw new Error("Execution reference must be non-empty");
  return value as ExecutionRef;
}

/** Convert a non-empty persisted/provider invocation identifier at the boundary. */
export function toInvocationRef(value: string): InvocationRef {
  if (value.trim() === "") throw new Error("Invocation reference must be non-empty");
  return value as InvocationRef;
}

/** `unknown` means no provider state or terminal evidence is available. */
export type InvocationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

/**
 * Least-privilege capability scoping carried through to the real spawn
 * call. Every field mirrors an explicit Mission Bundle grant (never
 * inferred): installed capability is not automatically assigned
 * capability. A kernel that cannot honor a field must fail closed rather
 * than silently ignore it, once it declares support for that field.
 */
export interface SpawnCapabilities {
  allowedTools?: readonly string[];
  allowedSkills?: readonly string[];
  modelPolicy?: readonly string[];
}

export interface InvocationContext {
  readonly operatorId: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly missionBundleId: string;
  readonly policyVersion: string;
  /** Numeric authority policy version required by local host effects. */
  readonly authorityPolicyVersion?: number;
  /** Durable Goal control epoch required by local host effects. */
  readonly controlEpoch?: string;
  /** Estimated effect cost in cents; read-only effects use zero. */
  readonly budgetEffectCents?: number;
  readonly accountRef?: string;
  readonly leaseRef?: string;
  readonly fencingToken?: string;
}

export type CanonicalOutboundDataClass = "public" | "workspace" | "private" | "pii" | "phi" | "secret";

/** Map explicitly recognized Mission Bundle labels to the narrow host-result vocabulary. Unknown or negative labels deny by omission. */
export function canonicalOutboundDataClasses(boundaries: readonly string[]): readonly CanonicalOutboundDataClass[] {
  const classes = new Set<CanonicalOutboundDataClass>();
  let invalidBoundary = false;
  for (const boundary of boundaries) {
    if (typeof boundary !== "string") { invalidBoundary = true; continue; }
    const value = boundary.trim().toLowerCase().replace(/\s+/g, " ");
    if (value === "" || /(^| )(no|non|not|without|deny|denied|forbidden|exclude|excluded|none)( |$)/.test(value)) { invalidBoundary = true; continue; }
    if (["repository", "repository files only", "repository only", "local", "local repository only", "workspace", "workspace only"].includes(value)) classes.add("workspace");
    else if (["public", "public data", "public reports", "publicly shareable", "publicly shareable data"].includes(value)) classes.add("public");
    else if (["private", "private data"].includes(value)) classes.add("private");
    else if (["pii", "customer pii", "personally identifiable information"].includes(value)) classes.add("pii");
    else if (["phi", "protected health information"].includes(value)) classes.add("phi");
    else if (["secret", "secrets", "credentials", "credential data"].includes(value)) classes.add("secret");
    else invalidBoundary = true;
  }
  return invalidBoundary ? [] : [...classes];
}

export interface CapabilityGrant {
  readonly grantId: string;
  readonly parentGrantId?: string;
  readonly allowedTools: readonly string[];
  readonly allowedSkills: readonly string[];
  readonly modelPolicy: readonly string[];
  readonly pathScope: readonly string[];
  readonly outboundDataClasses: readonly string[];
  readonly remaining: {
    modelTurns: number;
    toolCalls: number;
    childCalls: number;
    outputTokens: number;
    wallTimeMs: number;
    retryCount: number;
  };
}

export interface SpawnRequest {
  name: string;
  cwd?: string;
  parent?: ExecutionRef;
  prompt?: string;
  /** Only meaningful for a root spawn (no parent); a child spawn inherits its root's session. */
  capabilities?: SpawnCapabilities;
  /** Required by the native runtime; optional while legacy test-only kernels remain supported. */
  context?: InvocationContext;
  grant?: CapabilityGrant;
  modelPolicy?: readonly string[];
  idempotencyKey?: string;
}

/** Host-created native admission fields passed unchanged into an ExecutionKernelPort. */
export interface ExecutionAdmission {
  readonly context: InvocationContext;
  readonly grant: CapabilityGrant;
  readonly modelPolicy: readonly string[];
  readonly idempotencyKey: string;
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

export interface ExecutionBindingEvidence {
  readonly model: ModelIdentity;
  readonly accountRef?: string;
  readonly gatewayInstanceId?: string;
  readonly gatewayBindingId?: string;
  readonly dataPolicyHash?: string;
}

export interface ExecutionKernelPort {
  spawn(request: SpawnRequest): Promise<SpawnedInvocation>;
  prompt(execution: ExecutionRef, text: string): Promise<void>;
  observe(execution: ExecutionRef): Promise<readonly InvocationObservation[]>;
  sendMessage(execution: ExecutionRef, invocation: InvocationRef, message: string): Promise<void>;
  cancel(invocation: InvocationRef): Promise<{ cancelled: boolean }>;
  getModelIdentity(execution: ExecutionRef): Promise<ModelIdentity>;
  /** Optional immutable gateway metadata used for durable native binding evidence. */
  getExecutionBinding?(execution: ExecutionRef): Promise<ExecutionBindingEvidence>;
  getToolEvents(invocation: InvocationRef): Promise<ToolEvents>;
  getUsage(invocation: InvocationRef): Promise<InvocationUsage>;
  getInvocationStatus(invocation: InvocationRef): Promise<InvocationStatus>;
  resume(execution: ExecutionRef): Promise<never>;
  reconnect(execution: ExecutionRef): Promise<never>;
  /**
   * Acknowledges that this invocation's terminal outcome has already been
   * durably recorded by the caller, so the kernel may release any in-process
   * state it still holds for it. A kernel MUST NOT evict terminal state on
   * its own initiative (e.g. on first terminal observation or a timer) --
   * only an explicit post-durable-write release from the caller proves the
   * evidence is safe to forget, since a retry after a failed durable write
   * still needs the same terminal observation available. Optional: kernels
   * with no unbounded in-process state (e.g. a durable/replayable adapter)
   * may omit it; callers must tolerate its absence.
   */
  release?(invocation: InvocationRef): Promise<void>;
  /** Stop admission and dispose provider resources during process shutdown. */
  close?(): Promise<void>;
}
