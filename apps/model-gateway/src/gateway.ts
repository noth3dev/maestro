import { randomUUID } from "node:crypto";
import { ProviderRegistry, type ProviderReference } from "@maestro/agent-runtime";
import type { GatewayAdmissionRequest, GatewayBinding, GatewayModelListRequest, GatewayTurnRequest, ModelCatalogEntry, ModelGatewayPort, ModelProviderPort, ProviderCancellationOutcome, ProviderPlugin } from "@maestro/agent-runtime";
import type { CredentialStore } from "./credential-store.js";

interface GatewayOptions {
  readonly registry: ProviderRegistry;
  readonly credentials: CredentialStore;
  readonly instanceId: string;
}

interface InternalBinding {
  readonly publicBinding: GatewayBinding;
  readonly operatorId: string;
  readonly provider: ModelProviderPort;
}

export class ModelGateway implements ModelGatewayPort {
  private readonly bindings = new Map<string, InternalBinding>();
  private closed = false;

  constructor(private readonly options: GatewayOptions) {}

  async listModels(_request: GatewayModelListRequest): Promise<readonly ModelCatalogEntry[]> {
    if (this.closed) throw new Error("model gateway is closed");
    return this.options.registry.listModels();
  }

  async admit(request: GatewayAdmissionRequest): Promise<GatewayBinding> {
    if (this.closed) throw new Error("model gateway is closed");
    const plugin = this.options.registry.resolve({ providerId: request.providerId, modelId: request.model.id });
    const identity = this.options.registry.resolveModel({ providerId: request.providerId, modelId: request.model.id });
    if (identity.provider !== request.model.provider || identity.id !== request.model.id) throw new Error("provider returned an unexpected model identity");
    const account = this.options.credentials.metadata(request.accountRef);
    if (account === undefined || account.operatorId !== request.operatorId || account.providerId !== request.providerId) throw new Error("credential binding is not owned by operator");
    const provider = await plugin.create({ model: identity, account: { providerId: account.providerId, accountRef: account.accountRef, authMode: account.authMode }, dataPolicyHash: request.dataPolicyHash });
    if (provider.identity.provider !== identity.provider || provider.identity.id !== identity.id || provider.accountRef !== account.accountRef) {
      await provider.close().catch(() => undefined);
      throw new Error("provider identity or account binding mismatch");
    }
    const publicBinding: GatewayBinding = { bindingId: `binding-${randomUUID()}`, gatewayInstanceId: this.options.instanceId, provider: identity, account: { providerId: account.providerId, accountRef: account.accountRef, authMode: account.authMode }, dataPolicyHash: request.dataPolicyHash };
    this.bindings.set(publicBinding.bindingId, { publicBinding, operatorId: request.operatorId, provider });
    return publicBinding;
  }

  async turn(request: GatewayTurnRequest) {
    const internal = this.bindings.get(request.binding.bindingId);
    if (internal === undefined || internal.publicBinding.gatewayInstanceId !== request.binding.gatewayInstanceId) throw new Error("unknown gateway binding");
    if (internal.publicBinding.provider.provider !== request.binding.provider.provider || internal.publicBinding.provider.id !== request.binding.provider.id) throw new Error("gateway binding model mismatch");
    const result = await internal.provider.turn(request);
    if (result.model.provider !== request.binding.provider.provider || result.model.id !== request.binding.provider.id) throw new Error("provider returned an unexpected model identity");
    return result;
  }

  async cancel(requestId: string, signal?: AbortSignal): Promise<ProviderCancellationOutcome> {
    for (const { provider } of this.bindings.values()) {
      const outcome = await provider.cancel(requestId, signal);
      if (outcome.state !== "unsupported") return outcome;
    }
    return { state: "unsupported" };
  }

  async recover(binding: GatewayBinding): Promise<"reconnected" | "terminal" | "unknown"> {
    if (this.closed || binding.gatewayInstanceId !== this.options.instanceId || !this.bindings.has(binding.bindingId)) return "unknown";
    return "reconnected";
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.bindings.values()].map(({ provider }) => provider.close().catch(() => undefined)));
    this.bindings.clear();
  }
}

export function createModelGateway(options: GatewayOptions): ModelGateway {
  return new ModelGateway(options);
}

export type { ProviderPlugin, ProviderReference };
