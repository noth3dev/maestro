import type {
  ModelCatalogEntry,
  ModelContentPart,
  ModelMessage,
  ModelProviderPort,
  ModelToolCall,
  ModelTurnRequest,
  ProviderDataPolicy,
  ProviderModelRequest,
  ProviderPlugin,
} from "@maestro/agent-runtime";
import { normalizeToolArguments } from "@maestro/agent-runtime";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class CodexResponsesError extends Error {
  readonly name = "CodexResponsesError";
  constructor(
    readonly code: "provider_auth" | "provider_quota" | "provider_unavailable" | "provider_malformed_response" | "provider_cancelled",
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

/** Resolves a fresh, non-expired ChatGPT Codex access token for one operator/account. */
export type ResolveCodexAccessToken = (accountRef: string) => Promise<{ accessToken: string; accountId: string }>;

export interface CodexResponsesPluginOptions {
  readonly fetch?: Fetch;
  readonly resolveAccessToken: ResolveCodexAccessToken;
  readonly baseUrl?: string;
  readonly models?: readonly string[];
}

const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api/codex";

const codexDataPolicy: ProviderDataPolicy = {
  allowedDataClasses: ["public", "workspace"],
  retention: "provider-policy",
  trainsOnCustomerData: false,
  regions: ["us"],
};

const textOf = (parts: readonly ModelContentPart[]): string =>
  parts.filter((part): part is Extract<ModelContentPart, { kind: "text" }> => part.kind === "text").map((part) => part.text).join("\n");

function toResponsesInput(messages: readonly ModelMessage[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const message of messages) {
    const toolCallParts = message.content.filter((part): part is Extract<ModelContentPart, { kind: "tool-call" }> => part.kind === "tool-call");
    const toolResultParts = message.content.filter((part): part is Extract<ModelContentPart, { kind: "tool-result" }> => part.kind === "tool-result");
    const text = textOf(message.content);
    // "tool" is a valid ModelRole but not a Responses API text-item role: a
    // tool-result message must become a function_call_output item below, never
    // a bare {role:"tool", content} text item (the API has no such role).
    if (text !== "" && message.role !== "tool") items.push({ role: message.role === "developer-data" ? "user" : message.role, content: text });
    for (const part of toolCallParts) {
      items.push({
        type: "function_call",
        call_id: part.call.id,
        name: part.call.name,
        arguments: part.call.arguments.state === "valid" ? JSON.stringify(part.call.arguments.value) : part.call.arguments.raw,
      });
    }
    for (const part of toolResultParts) {
      items.push({ type: "function_call_output", call_id: part.toolCallId, output: part.content });
    }
  }
  return items;
}

function toResponsesTools(tools: ModelTurnRequest["tools"]): Record<string, unknown>[] {
  return tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false }));
}

interface StreamAssembly {
  text: string;
  toolCalls: ModelToolCall[];
  usage: { totalTokens?: number };
  responseFailure?: string;
}

async function* parseSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (response.body === null) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLines = chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
        if (dataLines.length > 0) {
          const data = dataLines.join("\n").trim();
          if (data !== "" && data !== "[DONE]") {
            try {
              yield JSON.parse(data) as Record<string, unknown>;
            } catch {
              throw new CodexResponsesError("provider_malformed_response", false, "Codex returned malformed SSE data");
            }
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function processCodexStream(response: Response, request: ModelTurnRequest): Promise<StreamAssembly> {
  const assembly: StreamAssembly = { text: "", toolCalls: [], usage: {} };
  let cursor = 0;
  const pendingCallArgs = new Map<string, { callId: string; name: string; args: string }>();
  for await (const event of parseSSE(response)) {
    const type = typeof event.type === "string" ? event.type : undefined;
    if (type === undefined) continue;
    if (type === "error") {
      const message = typeof event.message === "string" ? event.message : "Codex returned an error";
      throw new CodexResponsesError("provider_unavailable", true, message);
    }
    if (type === "response.failed") {
      const failure = isRecord(event.response) && isRecord(event.response.error) ? event.response.error : undefined;
      const message = typeof failure?.message === "string" ? failure.message : "Codex response failed";
      throw new CodexResponsesError("provider_unavailable", true, message);
    }
    if (type === "response.output_item.added" && isRecord(event.item) && event.item.type === "function_call") {
      const item = event.item;
      const itemId = typeof item.id === "string" ? item.id : "";
      pendingCallArgs.set(itemId, { callId: typeof item.call_id === "string" ? item.call_id : itemId, name: typeof item.name === "string" ? item.name : "", args: typeof item.arguments === "string" ? item.arguments : "" });
      continue;
    }
    if (type === "response.function_call_arguments.delta" && typeof event.item_id === "string" && typeof event.delta === "string") {
      const pending = pendingCallArgs.get(event.item_id);
      if (pending !== undefined) pending.args += event.delta;
      continue;
    }
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      assembly.text += event.delta;
      cursor += 1;
      request.emit({ kind: "text-delta", cursor, text: event.delta });
      continue;
    }
    if (type === "response.output_item.done" && isRecord(event.item) && event.item.type === "function_call") {
      const item = event.item;
      const itemId = typeof item.id === "string" ? item.id : "";
      const pending = pendingCallArgs.get(itemId);
      const rawArgs = (typeof item.arguments === "string" && item.arguments !== "" ? item.arguments : pending?.args) ?? "";
      const call: ModelToolCall = {
        id: typeof item.call_id === "string" ? item.call_id : pending?.callId ?? itemId,
        name: typeof item.name === "string" ? item.name : pending?.name ?? "",
        arguments: normalizeToolArguments(rawArgs),
      };
      assembly.toolCalls.push(call);
      cursor += 1;
      request.emit({ kind: "tool-proposed", cursor, call });
      continue;
    }
    if (type === "response.completed" || type === "response.incomplete") {
      const usage = isRecord(event.response) ? event.response.usage : undefined;
      const totalTokens = isRecord(usage) && typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
      if (totalTokens !== undefined) assembly.usage.totalTokens = totalTokens;
      cursor += 1;
      request.emit({ kind: "usage", cursor, usage: totalTokens === undefined ? { state: "unknown" } : { state: "available", totalTokens } });
    }
  }
  return assembly;
}

class CodexResponsesProvider implements ModelProviderPort {
  readonly capabilities = new Set(["text", "tool-calls", "streaming", "cancellation", "managed-subscription"] as const);
  private readonly active = new Map<string, AbortController>();

  constructor(
    readonly identity: { provider: "openai-codex"; id: string },
    readonly accountRef: string,
    private readonly fetchImpl: Fetch,
    private readonly resolveAccessToken: ResolveCodexAccessToken,
    private readonly baseUrl: string,
  ) {}

  async turn(request: ModelTurnRequest) {
    if (request.signal.aborted) throw new CodexResponsesError("provider_cancelled", false, "Codex request cancelled");
    if (this.active.has(request.requestId)) throw new CodexResponsesError("provider_unavailable", false, "Codex request id is already active");
    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    try {
      const { accessToken, accountId } = await this.resolveAccessToken(this.accountRef);
      const body = {
        model: this.identity.id,
        store: false,
        stream: true,
        instructions: "You are a helpful assistant.",
        input: toResponsesInput(request.messages),
        tool_choice: "auto",
        parallel_tool_calls: true,
        ...(request.tools.length > 0 ? { tools: toResponsesTools(request.tools) } : {}),
      };
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "chatgpt-account-id": accountId,
          originator: "maestro",
          "content-type": "application/json",
          accept: "text/event-stream",
          "OpenAI-Beta": "responses=experimental",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) throw new CodexResponsesError("provider_auth", false, "Codex authentication failed");
        if (response.status === 429) throw new CodexResponsesError("provider_quota", true, "Codex quota is unavailable");
        throw new CodexResponsesError("provider_unavailable", response.status >= 500, `Codex request failed: ${text || response.statusText}`);
      }
      const assembly = await processCodexStream(response, request);
      return {
        requestId: request.requestId,
        model: this.identity,
        text: assembly.text,
        toolCalls: assembly.toolCalls,
        stopReason: assembly.toolCalls.length > 0 ? ("tool_use" as const) : ("end_turn" as const),
        usage: assembly.usage.totalTokens === undefined ? { state: "unknown" as const } : { state: "available" as const, totalTokens: assembly.usage.totalTokens },
      };
    } catch (error) {
      if (error instanceof CodexResponsesError) throw error;
      if (signal.aborted) throw new CodexResponsesError("provider_cancelled", false, "Codex request cancelled");
      throw new CodexResponsesError("provider_unavailable", true, error instanceof Error ? error.message : "Codex transport failed");
    } finally {
      this.active.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<{ state: "requested" | "unsupported"; providerRequestRef?: string }> {
    const controller = this.active.get(requestId);
    if (controller === undefined) return { state: "unsupported" };
    controller.abort();
    return { state: "requested", providerRequestRef: requestId };
  }

  async close(): Promise<void> {}
}

export function createCodexResponsesPlugin(options: CodexResponsesPluginOptions): ProviderPlugin {
  const models = options.models ?? ["gpt-6-astra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"];
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const capabilities = new Set(["text", "tool-calls", "streaming", "cancellation", "managed-subscription"] as const);
  const catalog = (): readonly ModelCatalogEntry[] =>
    models.map((id) => ({ identity: { provider: "openai-codex", id }, capabilities, authModes: ["managed-subscription"], dataPolicy: codexDataPolicy }));
  return {
    id: "openai-codex",
    authModes: ["managed-subscription"],
    capabilities,
    dataPolicy: codexDataPolicy,
    listModels: catalog,
    async create(request: ProviderModelRequest): Promise<ModelProviderPort> {
      if (request.model.provider !== "openai-codex" || request.account.providerId !== "openai-codex" || request.account.authMode !== "managed-subscription")
        throw new CodexResponsesError("provider_auth", false, "Codex managed account binding mismatch");
      if (!models.includes(request.model.id)) throw new CodexResponsesError("provider_malformed_response", false, "Codex model is not in the configured catalog");
      return new CodexResponsesProvider(request.model as { provider: "openai-codex"; id: string }, request.account.accountRef, fetchImpl, options.resolveAccessToken, baseUrl);
    },
  };
}
