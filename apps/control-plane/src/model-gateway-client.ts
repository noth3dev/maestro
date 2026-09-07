import type { GatewayAdmissionRequest, GatewayBinding, GatewayModelListRequest, GatewayTurnRequest, ModelCatalogEntry, ModelGatewayPort, ModelProviderPort, ModelTurnResult, ProviderCancellationOutcome, ProviderCapability } from "@maestro/agent-runtime";

export type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ModelGatewayClientError extends Error {
  readonly name = "ModelGatewayClientError";
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

function mapModel(model: { identity: { provider: string; id: string }; capabilities: readonly string[]; authModes: readonly ("api-key" | "managed-subscription")[]; dataPolicy: ModelCatalogEntry["dataPolicy"] }): ModelCatalogEntry {
  return { ...model, capabilities: new Set(model.capabilities as readonly ProviderCapability[]) };
}

function parseError(body: unknown, status: number): ModelGatewayClientError {
  const candidate = body && typeof body === "object" ? (body as { error?: { code?: unknown; message?: unknown } }).error : undefined;
  const code = candidate && typeof candidate.code === "string" ? candidate.code : status >= 500 ? "provider_unavailable" : "gateway_request_failed";
  const message = candidate && typeof candidate.message === "string" ? candidate.message : "model gateway request failed";
  return new ModelGatewayClientError(code, status, message);
}

export function createModelGatewayClient(options: { baseUrl: string; token: string; fetch?: Fetch; timeoutMs?: number }): ModelGatewayPort {
  const base = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
  const loopback = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "::1";
  if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) throw new Error("Model gateway URL must use HTTPS unless it is loopback");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive safe integer");
  const headers = { authorization: `Bearer ${options.token}` };

  const request = async <T>(path: string, init: RequestInit, parse: (body: unknown) => T): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, base).href, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.any([controller.signal, ...(init.signal ? [init.signal] : [])]), redirect: "error" });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) throw parseError(body, response.status);
      return parse(body);
    } catch (error) {
      if (error instanceof ModelGatewayClientError) throw error;
      throw new ModelGatewayClientError("provider_unavailable", 503, "model gateway request failed");
    } finally { clearTimeout(timer); }
  };

  const identity = (value: unknown): { provider: string; id: string } => {
    if (!value || typeof value !== "object") throw new ModelGatewayClientError("gateway_request_failed", 502, "model gateway returned malformed identity");
    const provider = (value as { provider?: unknown }).provider;
    const id = (value as { id?: unknown }).id;
    if (typeof provider !== "string" || typeof id !== "string") throw new ModelGatewayClientError("gateway_request_failed", 502, "model gateway returned malformed identity");
    return { provider, id };
  };
  const binding = (value: unknown): GatewayBinding => {
    if (!value || typeof value !== "object") throw new ModelGatewayClientError("gateway_request_failed", 502, "model gateway returned malformed binding");
    const record = value as Record<string, unknown>;
    const provider = identity(record.provider);
    const account = record.account as Record<string, unknown> | undefined;
    if (!account || typeof account.providerId !== "string" || typeof account.accountRef !== "string" || (account.authMode !== "api-key" && account.authMode !== "managed-subscription") || typeof record.bindingId !== "string" || typeof record.gatewayInstanceId !== "string" || typeof record.dataPolicyHash !== "string") throw new ModelGatewayClientError("gateway_request_failed", 502, "model gateway returned malformed binding");
    return { bindingId: record.bindingId, gatewayInstanceId: record.gatewayInstanceId, provider, account: { providerId: account.providerId, accountRef: account.accountRef, authMode: account.authMode }, dataPolicyHash: record.dataPolicyHash };
  };

  return {
    async listModels(requestInput: GatewayModelListRequest) {
      const query = new URLSearchParams({ operatorId: requestInput.operatorId });
      return request(`v1/models?${query}`, { method: "GET" }, (body) => {
        if (!Array.isArray(body)) throw new ModelGatewayClientError("gateway_request_failed", 502, "model gateway returned malformed models");
        return body.map((item) => {
          if (!item || typeof item !== "object") throw new ModelGatewayClientError("gateway_request_failed", 502, "model gateway returned malformed model");
          const record = item as Record<string, unknown>;
          const modelIdentity = identity(record.identity);
          if (!Array.isArray(record.capabilities) || !Array.isArray(record.authModes) || !record.dataPolicy || typeof record.dataPolicy !== "object") throw new ModelGatewayClientError("gateway_request_failed", 502, "model gateway returned malformed model");
          return mapModel({ identity: modelIdentity, capabilities: record.capabilities.filter((v): v is ProviderCapability => v === "text" || v === "tool-calls" || v === "streaming" || v === "usage" || v === "cancellation" || v === "managed-subscription"), authModes: record.authModes.filter((v): v is "api-key" | "managed-subscription" => v === "api-key" || v === "managed-subscription"), dataPolicy: record.dataPolicy as ModelCatalogEntry["dataPolicy"] });
        });
      });
    },
    async admit(input: GatewayAdmissionRequest) {
      return request("v1/admit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }, binding);
    },
    async turn(input: GatewayTurnRequest): Promise<ModelTurnResult> {
      const body = { binding: input.binding, requestId: input.requestId, sessionId: input.sessionId, turnId: input.turnId, messages: input.messages, tools: input.tools, limits: input.limits };
      return request("v1/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: input.signal }, (value) => value as ModelTurnResult);
    },
    async cancel(requestId: string, signal?: AbortSignal): Promise<ProviderCancellationOutcome> {
      return request("v1/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId }), ...(signal === undefined ? {} : { signal }) }, (value) => value as ProviderCancellationOutcome);
    },
    async recover(input: GatewayBinding) {
      return request("v1/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ binding: input }) }, (value) => {
        const state = value && typeof value === "object" ? (value as { state?: unknown }).state : undefined;
        if (state !== "reconnected" && state !== "terminal" && state !== "unknown") throw new ModelGatewayClientError("gateway_request_failed", 502, "model gateway returned malformed recovery state");
        return state;
      });
    },
    async close() {},
  };
}

export type { ModelProviderPort };
