import type { InvocationUsage } from "@maestro/domain";
import { normalizeToolArguments, type ModelContentPart, type ModelMessage, type ModelProviderPort, type ModelTurnRequest, type ProviderDataPolicy, type ProviderPlugin, type ProviderModelRequest, type ModelCatalogEntry, type ProviderCancellationOutcome } from "@maestro/agent-runtime";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class AnthropicProviderError extends Error {
  readonly name = "AnthropicProviderError";
  constructor(readonly code: "provider_auth" | "provider_quota" | "provider_unavailable" | "provider_model_mismatch" | "provider_malformed_response" | "provider_cancelled", readonly retryable: boolean, message: string) {
    super(message);
  }
}

export interface AnthropicPluginOptions {
  readonly fetch?: Fetch;
  readonly resolveApiKey: (accountRef: string) => Promise<string>;
  readonly baseUrl?: string;
  readonly models?: readonly string[];
}

const dataPolicy: ProviderDataPolicy = {
  allowedDataClasses: ["public", "workspace"],
  retention: "provider-policy",
  trainsOnCustomerData: false,
  regions: ["us"] ,
};

function textOf(parts: readonly ModelContentPart[]): string {
  return parts.filter((part): part is Extract<ModelContentPart, { kind: "text" }> => part.kind === "text").map((part) => part.text).join("\n");
}

function toMessage(message: ModelMessage): Record<string, unknown> {
  const blocks = message.content.map((part) => {
    if (part.kind === "text") return { type: "text", text: part.text };
    if (part.kind === "tool-call") return { type: "tool_use", id: part.call.id, name: part.call.name, input: part.call.arguments.state === "valid" ? part.call.arguments.value : {} };
    return { type: "tool_result", tool_use_id: part.toolCallId, content: part.content, is_error: part.status !== "ok" };
  });
  return { role: message.role === "assistant" ? "assistant" : "user", content: blocks };
}

function usageOf(value: unknown): InvocationUsage {
  if (!value || typeof value !== "object") return { state: "unknown" };
  const input = (value as { input_tokens?: unknown }).input_tokens;
  const output = (value as { output_tokens?: unknown }).output_tokens;
  if (typeof input !== "number" || typeof output !== "number" || input < 0 || output < 0 || !Number.isSafeInteger(input + output)) return { state: "unknown" };
  return { state: "available", totalTokens: input + output };
}

class AnthropicProvider implements ModelProviderPort {
  readonly capabilities = new Set(["text", "tool-calls", "usage", "cancellation"] as const);
  private readonly active = new Map<string, AbortController>();

  constructor(
    readonly identity: { provider: "anthropic"; id: string },
    readonly accountRef: string,
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch,
    private readonly baseUrl: string,
  ) {}

  async turn(request: ModelTurnRequest) {
    if (request.signal.aborted) throw new AnthropicProviderError("provider_cancelled", false, "Anthropic request cancelled");
    if (this.active.has(request.requestId)) throw new AnthropicProviderError("provider_unavailable", false, "Anthropic request ID is already active");
    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    try {
      const system = request.messages.filter((message) => message.role === "system").map((message) => textOf(message.content)).join("\n");
      const body = {
        model: this.identity.id,
        max_tokens: request.limits.maxOutputTokens,
        ...(system ? { system } : {}),
        messages: request.messages.filter((message) => message.role !== "system").map(toMessage),
        tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
      };
      const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new AnthropicProviderError("provider_auth", false, "Anthropic authentication failed");
        if (response.status === 429) throw new AnthropicProviderError("provider_quota", true, "Anthropic quota is unavailable");
        throw new AnthropicProviderError("provider_unavailable", response.status >= 500, "Anthropic request failed");
      }
      const raw: unknown = await response.json().catch(() => undefined);
      if (!raw || typeof raw !== "object") throw new AnthropicProviderError("provider_malformed_response", false, "Anthropic response is not an object");
      const model = (raw as { model?: unknown }).model;
      if (typeof model !== "string" || model !== this.identity.id) throw new AnthropicProviderError("provider_model_mismatch", false, "Anthropic returned an unexpected model identity");
      const content = (raw as { content?: unknown }).content;
      if (!Array.isArray(content)) throw new AnthropicProviderError("provider_malformed_response", false, "Anthropic response has no content");
      let text = "";
      const toolCalls = [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if ((block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string") text += (block as { text: string }).text;
        if ((block as { type?: unknown }).type === "tool_use") {
          const id = (block as { id?: unknown }).id;
          const name = (block as { name?: unknown }).name;
          const input = (block as { input?: unknown }).input;
          if (typeof id !== "string" || typeof name !== "string") throw new AnthropicProviderError("provider_malformed_response", false, "Anthropic returned malformed tool call");
          const call = { id, name, arguments: normalizeToolArguments(input) };
          toolCalls.push(call);
          request.emit({ kind: "tool-proposed", cursor: toolCalls.length, call });
        }
      }
      if (text) request.emit({ kind: "text-delta", cursor: 0, text });
      const usage = usageOf((raw as { usage?: unknown }).usage);
      request.emit({ kind: "usage", cursor: toolCalls.length + 1, usage });
      return { requestId: request.requestId, model: this.identity, text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" as const : "end_turn" as const, usage };
    } catch (error) {
      if (error instanceof AnthropicProviderError) throw error;
      if (signal.aborted) throw new AnthropicProviderError("provider_cancelled", false, "Anthropic request cancelled");
      throw new AnthropicProviderError("provider_unavailable", true, "Anthropic transport failed");
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

export function createAnthropicPlugin(options: AnthropicPluginOptions): ProviderPlugin {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  const models = options.models ?? ["claude-sonnet-4-5"];
  const catalog = (): readonly ModelCatalogEntry[] => models.map((id) => ({ identity: { provider: "anthropic", id }, capabilities: new Set(["text", "tool-calls", "usage", "cancellation"] as const), authModes: ["api-key"], dataPolicy }));
  return {
    id: "anthropic", authModes: ["api-key"], capabilities: new Set(["text", "tool-calls", "usage", "cancellation"] as const), dataPolicy, listModels: catalog,
    async create(request: ProviderModelRequest): Promise<ModelProviderPort> {
      if (request.model.provider !== "anthropic" || request.account.providerId !== "anthropic") throw new AnthropicProviderError("provider_model_mismatch", false, "Anthropic account/model binding mismatch");
      if (!models.includes(request.model.id)) throw new AnthropicProviderError("provider_model_mismatch", false, "Anthropic model is not in the configured catalog");
      const apiKey = await options.resolveApiKey(request.account.accountRef);
      if (!apiKey) throw new AnthropicProviderError("provider_auth", false, "Anthropic API key is unavailable");
      return new AnthropicProvider(request.model as { provider: "anthropic"; id: string }, request.account.accountRef, apiKey, fetchImpl, baseUrl);
    },
  };
}
