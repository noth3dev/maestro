import type { InvocationUsage } from "@maestro/domain";
import { normalizeToolArguments, type ModelContentPart, type ModelMessage, type ModelProviderPort, type ModelTurnRequest, type ProviderDataPolicy, type ProviderPlugin, type ProviderModelRequest, type ModelCatalogEntry, type ProviderCancellationOutcome } from "@maestro/agent-runtime";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class OpenAiProviderError extends Error {
  readonly name = "OpenAiProviderError";
  constructor(readonly code: "provider_auth" | "provider_quota" | "provider_unavailable" | "provider_model_mismatch" | "provider_malformed_response" | "provider_cancelled", readonly retryable: boolean, message: string) {
    super(message);
  }
}

export interface OpenAiPluginOptions {
  readonly fetch?: Fetch;
  readonly resolveApiKey: (accountRef: string) => Promise<string>;
  readonly baseUrl?: string;
  readonly models?: readonly string[];
}

const dataPolicy: ProviderDataPolicy = {
  allowedDataClasses: ["public", "workspace"],
  retention: "provider-policy",
  trainsOnCustomerData: false,
  regions: ["us"],
};

const textOf = (parts: readonly ModelContentPart[]): string => parts
  .filter((part): part is Extract<ModelContentPart, { kind: "text" }> => part.kind === "text")
  .map((part) => part.text)
  .join("\n");

function toInputMessage(message: ModelMessage): Record<string, unknown> {
  const text = textOf(message.content);
  const role = message.role === "developer-data" ? "user" : message.role;
  return { role, content: text };
}

function toToolDefinition(tool: ModelTurnRequest["tools"][number]): Record<string, unknown> {
  return { type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: true };
}

function usageOf(value: unknown): InvocationUsage {
  if (!value || typeof value !== "object") return { state: "unknown" };
  const total = (value as { total_tokens?: unknown }).total_tokens;
  return typeof total === "number" && Number.isSafeInteger(total) && total >= 0
    ? { state: "available", totalTokens: total }
    : { state: "unknown" };
}

function responseModel(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") throw new OpenAiProviderError("provider_malformed_response", false, "OpenAI response is not an object");
  const model = (value as { model?: unknown }).model;
  if (typeof model !== "string" || model !== fallback) throw new OpenAiProviderError("provider_model_mismatch", false, "OpenAI returned an unexpected model identity");
  return model;
}

class OpenAiProvider implements ModelProviderPort {
  readonly capabilities = new Set(["text", "tool-calls", "usage", "cancellation"] as const);
  private readonly active = new Map<string, AbortController>();

  constructor(
    readonly identity: { provider: "openai"; id: string },
    readonly accountRef: string,
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch,
    private readonly baseUrl: string,
  ) {}

  async turn(request: ModelTurnRequest) {
    if (request.signal.aborted) throw new OpenAiProviderError("provider_cancelled", false, "OpenAI request cancelled");
    if (this.active.has(request.requestId)) throw new OpenAiProviderError("provider_unavailable", false, "OpenAI request ID is already active");
    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.identity.id,
          input: request.messages.map(toInputMessage),
          tools: request.tools.map(toToolDefinition),
          max_output_tokens: request.limits.maxOutputTokens,
        }),
        signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new OpenAiProviderError("provider_auth", false, "OpenAI authentication failed");
        if (response.status === 429) throw new OpenAiProviderError("provider_quota", true, "OpenAI quota is unavailable");
        throw new OpenAiProviderError("provider_unavailable", response.status >= 500, "OpenAI request failed");
      }
      const body: unknown = await response.json().catch(() => undefined);
      responseModel(body, this.identity.id);
      const output = body && typeof body === "object" && Array.isArray((body as { output?: unknown }).output) ? (body as { output: unknown[] }).output : undefined;
      if (output === undefined) throw new OpenAiProviderError("provider_malformed_response", false, "OpenAI response has no output");
      let text = "";
      const toolCalls = [];
      for (const item of output) {
        if (!item || typeof item !== "object") continue;
        const type = (item as { type?: unknown }).type;
        if (type === "message") {
          const content = (item as { content?: unknown }).content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") text += (part as { text: string }).text;
            }
          }
        } else if (type === "function_call") {
          const id = (item as { call_id?: unknown; id?: unknown }).call_id ?? (item as { id?: unknown }).id;
          const name = (item as { name?: unknown }).name;
          const args = (item as { arguments?: unknown }).arguments;
          if (typeof id !== "string" || typeof name !== "string" || (typeof args !== "string" && (typeof args !== "object" || args === null))) throw new OpenAiProviderError("provider_malformed_response", false, "OpenAI returned malformed function call");
          const call = { id, name, arguments: normalizeToolArguments(args) };
          toolCalls.push(call);
          request.emit({ kind: "tool-proposed", cursor: toolCalls.length, call });
        }
      }
      if (text) request.emit({ kind: "text-delta", cursor: 0, text });
      const usage = usageOf(body && typeof body === "object" ? (body as { usage?: unknown }).usage : undefined);
      request.emit({ kind: "usage", cursor: toolCalls.length + 1, usage });
      return { requestId: request.requestId, model: this.identity, text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" as const : "end_turn" as const, usage };
    } catch (error) {
      if (error instanceof OpenAiProviderError) throw error;
      if (signal.aborted) throw new OpenAiProviderError("provider_cancelled", false, "OpenAI request cancelled");
      throw new OpenAiProviderError("provider_unavailable", true, "OpenAI transport failed");
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

export function createOpenAiPlugin(options: OpenAiPluginOptions): ProviderPlugin {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const models = options.models ?? ["gpt-5"];
  const catalog = (): readonly ModelCatalogEntry[] => models.map((id) => ({ identity: { provider: "openai", id }, capabilities: new Set(["text", "tool-calls", "usage", "cancellation"] as const), authModes: ["api-key"], dataPolicy }));
  return {
    id: "openai", authModes: ["api-key"], capabilities: new Set(["text", "tool-calls", "usage", "cancellation"] as const), dataPolicy, listModels: catalog,
    async create(request: ProviderModelRequest): Promise<ModelProviderPort> {
      if (request.model.provider !== "openai" || request.account.providerId !== "openai") throw new OpenAiProviderError("provider_model_mismatch", false, "OpenAI account/model binding mismatch");
      if (!models.includes(request.model.id)) throw new OpenAiProviderError("provider_model_mismatch", false, "OpenAI model is not in the configured catalog");
      const apiKey = await options.resolveApiKey(request.account.accountRef);
      if (!apiKey) throw new OpenAiProviderError("provider_auth", false, "OpenAI API key is unavailable");
      return new OpenAiProvider(request.model as { provider: "openai"; id: string }, request.account.accountRef, apiKey, fetchImpl, baseUrl);
    },
  };
}

export * from "./codex-app-server.js";
