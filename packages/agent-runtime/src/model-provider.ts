import type { InvocationUsage, ModelIdentity } from "@maestro/domain";
export type { InvocationUsage, ModelIdentity } from "@maestro/domain";

export type ProviderCapability =
  | "text"
  | "tool-calls"
  | "streaming"
  | "usage"
  | "cancellation"
  | "managed-subscription";

export type ProviderAuthMode = "api-key" | "managed-subscription";
export type ModelRole = "system" | "user" | "assistant" | "tool" | "developer-data";
export type ToolResultStatus = "ok" | "error" | "unknown";

export interface TurnLimits {
  readonly maxModelTurns: number;
  readonly maxToolCalls: number;
  readonly maxChildCalls: number;
  readonly maxOutputTokens: number;
  readonly maxInputBytes: number;
  readonly maxResultBytes: number;
  readonly providerTimeoutMs: number;
  readonly wallTimeMs: number;
}

export type ToolArguments =
  | { readonly state: "valid"; readonly value: unknown }
  | { readonly state: "invalid"; readonly raw: string; readonly reason: "malformed-json" | "not-an-object" };

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: ToolArguments;
}

export interface ModelToolResultMessage {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly status: ToolResultStatus;
  readonly content: string;
  readonly origin: "host";
  readonly trust: "untrusted-data";
}

export type ModelContentPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool-call"; readonly call: ModelToolCall }
  | { readonly kind: "tool-result"; readonly toolCallId: string; readonly status: ToolResultStatus; readonly content: string; readonly origin: "host"; readonly trust: "untrusted-data" };

export interface ModelMessage {
  readonly role: ModelRole;
  readonly content: readonly ModelContentPart[];
}

export type ModelStreamEvent =
  | { readonly kind: "text-delta"; readonly cursor: number; readonly text: string }
  | { readonly kind: "tool-proposed"; readonly cursor: number; readonly call: ModelToolCall }
  | { readonly kind: "tool-validated"; readonly cursor: number; readonly callId: string; readonly toolName: string }
  | { readonly kind: "tool-executing"; readonly cursor: number; readonly callId: string; readonly toolName: string }
  | { readonly kind: "tool-completed"; readonly cursor: number; readonly callId: string; readonly toolName: string; readonly status: ToolResultStatus }
  | { readonly kind: "tool-rejected"; readonly cursor: number; readonly callId: string; readonly toolName: string; readonly reason: string }
  | { readonly kind: "usage"; readonly cursor: number; readonly usage: InvocationUsage }
  | { readonly kind: "provider-error"; readonly cursor: number; readonly code: string; readonly retryable: boolean }
  | { readonly kind: "terminal"; readonly cursor: number; readonly status: "succeeded" | "failed" | "cancelled" | "unknown" };

export interface ModelToolDefinition {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly allowsParallel: boolean;
  readonly outboundDataClass: "public" | "workspace" | "private" | "pii" | "phi" | "secret";
}

export interface ModelTurnRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ModelToolDefinition[];
  readonly limits: TurnLimits;
  readonly signal: AbortSignal;
  readonly emit: (event: ModelStreamEvent) => void;
}

export interface ModelTurnResult {
  readonly requestId: string;
  readonly model: ModelIdentity;
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly stopReason: "end_turn" | "tool_use" | "max_tokens" | "max_turns" | "cancelled" | "error";
  readonly usage: InvocationUsage;
}

export interface ProviderCancellationOutcome {
  readonly state: "confirmed" | "requested" | "unsupported" | "unknown";
  readonly providerRequestRef?: string;
}

export interface ProviderDataPolicy {
  readonly allowedDataClasses: readonly ("public" | "workspace" | "private" | "pii" | "phi" | "secret")[];
  readonly retention: "none" | "provider-policy" | "durable";
  readonly trainsOnCustomerData: boolean;
  readonly regions: readonly string[];
}

export interface ModelCatalogEntry {
  readonly identity: ModelIdentity;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  readonly authModes: readonly ProviderAuthMode[];
  readonly dataPolicy: ProviderDataPolicy;
}

export interface ProviderAccountBinding {
  readonly providerId: string;
  readonly accountRef: string;
  readonly authMode: ProviderAuthMode;
}

export interface ProviderModelRequest {
  readonly model: ModelIdentity;
  readonly account: ProviderAccountBinding;
  readonly dataPolicyHash: string;
}

export interface ModelProviderPort {
  readonly identity: ModelIdentity;
  readonly accountRef: string;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  turn(request: ModelTurnRequest): Promise<ModelTurnResult>;
  cancel(requestId: string, signal?: AbortSignal): Promise<ProviderCancellationOutcome>;
  close(): Promise<void>;
}

export interface ProviderPlugin {
  readonly id: string;
  readonly authModes: readonly ProviderAuthMode[];
  readonly capabilities: ReadonlySet<ProviderCapability>;
  readonly dataPolicy: ProviderDataPolicy;
  listModels(): readonly ModelCatalogEntry[];
  create(request: ProviderModelRequest): Promise<ModelProviderPort>;
}

export interface GatewayModelListRequest {
  readonly operatorId: string;
}

export interface GatewayAdmissionRequest {
  readonly requestId: string;
  readonly operatorId: string;
  readonly providerId: string;
  readonly model: ModelIdentity;
  readonly accountRef: string;
  readonly dataPolicyHash: string;
}

export interface GatewayCredentialBinding {
  readonly bindingId: string;
  readonly providerId: string;
  readonly accountRef: string;
  readonly authMode: ProviderAuthMode;
  readonly configuredAt: string;
}

export interface GatewayCredentialBindRequest {
  readonly requestId: string;
  readonly operatorId: string;
  readonly providerId: string;
  readonly authMode: ProviderAuthMode;
  readonly secret: string;
}

export interface GatewayCredentialRevokeRequest {
  readonly requestId: string;
  readonly operatorId: string;
  readonly providerId: string;
}

export interface GatewayAccountLoginStartRequest {
  readonly requestId: string;
  readonly operatorId: string;
  readonly providerId: "openai-codex";
}

export interface GatewayAccountLoginStartResult {
  readonly providerId: "openai-codex";
  readonly loginId: string;
  readonly authUrl: string;
}

export interface GatewayAccountLoginStatusRequest {
  readonly requestId: string;
  readonly operatorId: string;
  readonly providerId: "openai-codex";
  readonly loginId: string;
}

export interface GatewayAccountLoginStatusResult {
  readonly providerId: "openai-codex";
  readonly loginId: string;
  readonly state: "pending" | "succeeded" | "failed" | "cancelled";
  readonly message?: string;
}

export interface GatewayAccountLogoutRequest {
  readonly requestId: string;
  readonly operatorId: string;
  readonly providerId: "openai-codex";
}

export interface GatewayBinding {
  readonly bindingId: string;
  readonly gatewayInstanceId: string;
  readonly provider: ModelIdentity;
  readonly account: ProviderAccountBinding;
  readonly dataPolicyHash: string;
}

export interface GatewayTurnRequest extends ModelTurnRequest {
  readonly binding: GatewayBinding;
}

export interface ModelGatewayPort {
  listModels(request: GatewayModelListRequest): Promise<readonly ModelCatalogEntry[]>;
  admit(request: GatewayAdmissionRequest): Promise<GatewayBinding>;
  /** Provider credential lifecycle is optional for test-only gateway doubles. */
  bindCredential?(request: GatewayCredentialBindRequest): Promise<GatewayCredentialBinding>;
  revokeCredential?(request: GatewayCredentialRevokeRequest): Promise<void>;
  startAccountLogin?(request: GatewayAccountLoginStartRequest): Promise<GatewayAccountLoginStartResult>;
  accountLoginStatus?(request: GatewayAccountLoginStatusRequest): Promise<GatewayAccountLoginStatusResult>;
  cancelAccountLogin?(request: GatewayAccountLoginStatusRequest): Promise<void>;
  logoutAccount?(request: GatewayAccountLogoutRequest): Promise<void>;
  turn(request: GatewayTurnRequest): Promise<ModelTurnResult>;
  cancel(requestId: string, signal?: AbortSignal): Promise<ProviderCancellationOutcome>;
  recover(binding: GatewayBinding): Promise<"reconnected" | "terminal" | "unknown">;
  close(): Promise<void>;
}

export function normalizeToolArguments(raw: unknown): ToolArguments {
  let value = raw;
  let serialized: string;
  if (typeof raw === "string") {
    serialized = raw;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { state: "invalid", raw, reason: "malformed-json" };
    }
  } else {
    serialized = JSON.stringify(raw) ?? String(raw);
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { state: "invalid", raw: serialized, reason: "not-an-object" };
  }
  return { state: "valid", value };
}

export function parseModelRef(ref: string): ModelIdentity {
  const separator = ref.indexOf("/");
  if (separator <= 0) throw new Error("Model reference must be provider-qualified");
  const provider = ref.slice(0, separator);
  const id = ref.slice(separator + 1);
  if (id.includes("/")) throw new Error("Model reference must be provider-qualified");
  if (!id || provider.trim() !== provider || id.trim() !== id || /\s/.test(provider) || /\s/.test(id)) throw new Error("Model reference must include a non-empty model id");
  return { provider, id };
}

export function formatModelRef(identity: ModelIdentity): string {
  if (!identity.provider || !identity.id) throw new Error("Model identity must include provider and model id");
  return `${identity.provider}/${identity.id}`;
}
