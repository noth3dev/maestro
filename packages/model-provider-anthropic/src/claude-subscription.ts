import type {
  ModelCatalogEntry,
  ModelProviderPort,
  ProviderCancellationOutcome,
  ProviderDataPolicy,
  ProviderModelRequest,
  ProviderPlugin,
} from "@maestro/agent-runtime";
import { normalizeToolArguments } from "@maestro/agent-runtime";
import type { InvocationUsage } from "@maestro/domain";
import type { ModelContentPart, ModelMessage, ModelTurnRequest } from "@maestro/agent-runtime";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Duplicated from ./index.ts's AnthropicProvider mapping helpers (rather than
// importing them) to avoid a circular module dependency between index.ts and
// this file, since index.ts re-exports everything from claude-subscription.ts.
// Keep in sync with AnthropicProvider's textOf/toMessage/usageOf.
function textOf(parts: readonly ModelContentPart[]): string {
  return parts
    .filter((part): part is Extract<ModelContentPart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("\n");
}

function toMessage(message: ModelMessage): Record<string, unknown> {
  const blocks = message.content.map((part) => {
    if (part.kind === "text") return { type: "text", text: part.text };
    if (part.kind === "tool-call")
      return {
        type: "tool_use",
        id: part.call.id,
        name: part.call.name,
        input: part.call.arguments.state === "valid" ? part.call.arguments.value : {},
      };
    return { type: "tool_result", tool_use_id: part.toolCallId, content: part.content, is_error: part.status !== "ok" };
  });
  return { role: message.role === "assistant" ? "assistant" : "user", content: blocks };
}

function usageOf(value: unknown): InvocationUsage {
  if (!value || typeof value !== "object") return { state: "unknown" };
  const input = (value as { input_tokens?: unknown }).input_tokens;
  const output = (value as { output_tokens?: unknown }).output_tokens;
  if (typeof input !== "number" || typeof output !== "number" || input < 0 || output < 0 || !Number.isSafeInteger(input + output))
    return { state: "unknown" };
  return { state: "available", totalTokens: input + output };
}

export class ClaudeSubscriptionError extends Error {
  readonly name = "ClaudeSubscriptionError";
  constructor(
    readonly code:
      | "provider_auth"
      | "provider_quota"
      | "provider_unavailable"
      | "provider_model_mismatch"
      | "provider_malformed_response"
      | "provider_cancelled",
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

/** Resolves a fresh, non-expired Anthropic (Claude Pro/Max) OAuth access token for one operator/account. */
export type ResolveClaudeAccessToken = (accountRef: string) => Promise<{ accessToken: string; accountId?: string }>;

export interface ClaudeSubscriptionPluginOptions {
  readonly fetch?: Fetch;
  readonly resolveAccessToken: ResolveClaudeAccessToken;
  readonly baseUrl?: string;
  readonly models?: readonly string[];
}

const dataPolicy: ProviderDataPolicy = {
  allowedDataClasses: ["public", "workspace"],
  retention: "provider-policy",
  trainsOnCustomerData: false,
  regions: ["us"],
};

/**
 * Provider plugin for the Anthropic Claude Pro/Max "managed subscription"
 * auth mode. Reuses the exact same Messages API request/response body
 * mapping as `AnthropicProvider` (see ./index.ts) — only the auth transport
 * differs: a Bearer OAuth access token plus the `anthropic-beta:
 * oauth-2025-04-20` header, instead of the `x-api-key` header used by
 * API-key auth.
 */
class ClaudeSubscriptionProvider implements ModelProviderPort {
  readonly capabilities = new Set(["text", "tool-calls", "usage", "cancellation", "managed-subscription"] as const);
  private readonly active = new Map<string, AbortController>();

  constructor(
    readonly identity: { provider: "anthropic-claude"; id: string },
    readonly accountRef: string,
    private readonly fetchImpl: Fetch,
    private readonly resolveAccessToken: ResolveClaudeAccessToken,
    private readonly baseUrl: string,
  ) {}

  async turn(request: ModelTurnRequest) {
    if (request.signal.aborted) throw new ClaudeSubscriptionError("provider_cancelled", false, "Claude request cancelled");
    if (this.active.has(request.requestId))
      throw new ClaudeSubscriptionError("provider_unavailable", false, "Claude request ID is already active");
    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    try {
      const { accessToken } = await this.resolveAccessToken(this.accountRef);
      const system = request.messages
        .filter((message: ModelMessage) => message.role === "system")
        .map((message: ModelMessage) => textOf(message.content))
        .join("\n");
      const body = {
        model: this.identity.id,
        max_tokens: request.limits.maxOutputTokens,
        ...(system ? { system } : {}),
        messages: request.messages.filter((message: ModelMessage) => message.role !== "system").map(toMessage),
        tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
      };
      const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new ClaudeSubscriptionError("provider_auth", false, "Claude authentication failed");
        if (response.status === 429) throw new ClaudeSubscriptionError("provider_quota", true, "Claude quota is unavailable");
        throw new ClaudeSubscriptionError("provider_unavailable", response.status >= 500, "Claude request failed");
      }
      const raw: unknown = await response.json().catch(() => undefined);
      if (!raw || typeof raw !== "object")
        throw new ClaudeSubscriptionError("provider_malformed_response", false, "Claude response is not an object");
      const model = (raw as { model?: unknown }).model;
      if (typeof model !== "string" || model !== this.identity.id)
        throw new ClaudeSubscriptionError("provider_model_mismatch", false, "Claude returned an unexpected model identity");
      const content = (raw as { content?: unknown }).content;
      if (!Array.isArray(content))
        throw new ClaudeSubscriptionError("provider_malformed_response", false, "Claude response has no content");
      let text = "";
      const toolCalls = [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if ((block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
          text += (block as { text: string }).text;
        if ((block as { type?: unknown }).type === "tool_use") {
          const id = (block as { id?: unknown }).id;
          const name = (block as { name?: unknown }).name;
          const input = (block as { input?: unknown }).input;
          if (typeof id !== "string" || typeof name !== "string")
            throw new ClaudeSubscriptionError("provider_malformed_response", false, "Claude returned malformed tool call");
          const call = { id, name, arguments: normalizeToolArguments(input) };
          toolCalls.push(call);
          request.emit({ kind: "tool-proposed", cursor: toolCalls.length, call });
        }
      }
      if (text) request.emit({ kind: "text-delta", cursor: 0, text });
      const usage: InvocationUsage = usageOf((raw as { usage?: unknown }).usage);
      request.emit({ kind: "usage", cursor: toolCalls.length + 1, usage });
      return {
        requestId: request.requestId,
        model: this.identity,
        text,
        toolCalls,
        stopReason: toolCalls.length > 0 ? ("tool_use" as const) : ("end_turn" as const),
        usage,
      };
    } catch (error) {
      if (error instanceof ClaudeSubscriptionError) throw error;
      if (signal.aborted) throw new ClaudeSubscriptionError("provider_cancelled", false, "Claude request cancelled");
      throw new ClaudeSubscriptionError("provider_unavailable", true, error instanceof Error ? error.message : "Claude transport failed");
    } finally {
      this.active.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<ProviderCancellationOutcome> {
    const controller = this.active.get(requestId);
    if (controller === undefined) return { state: "unsupported" };
    controller.abort();
    return { state: "requested", providerRequestRef: requestId };
  }

  async close(): Promise<void> {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }
}

export function createClaudeSubscriptionPlugin(options: ClaudeSubscriptionPluginOptions): ProviderPlugin {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  const models = options.models ?? ["claude-sonnet-4-5"];
  const capabilities = new Set(["text", "tool-calls", "usage", "cancellation", "managed-subscription"] as const);
  const catalog = (): readonly ModelCatalogEntry[] =>
    models.map((id) => ({ identity: { provider: "anthropic-claude", id }, capabilities, authModes: ["managed-subscription"], dataPolicy }));
  return {
    id: "anthropic-claude",
    authModes: ["managed-subscription"],
    capabilities,
    dataPolicy,
    listModels: catalog,
    async create(request: ProviderModelRequest): Promise<ModelProviderPort> {
      if (
        request.model.provider !== "anthropic-claude" ||
        request.account.providerId !== "anthropic-claude" ||
        request.account.authMode !== "managed-subscription"
      )
        throw new ClaudeSubscriptionError("provider_auth", false, "Claude managed account binding mismatch");
      if (!models.includes(request.model.id))
        throw new ClaudeSubscriptionError("provider_malformed_response", false, "Claude model is not in the configured catalog");
      return new ClaudeSubscriptionProvider(
        request.model as { provider: "anthropic-claude"; id: string },
        request.account.accountRef,
        fetchImpl,
        options.resolveAccessToken,
        baseUrl,
      );
    },
  };
}
