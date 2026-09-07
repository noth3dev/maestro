import { formatModelRef, type ModelCatalogEntry, type ModelIdentity, type ProviderCapability, type ProviderPlugin } from "./model-provider.js";

export interface GoalDataPolicy {
  readonly allowedDataClasses: readonly ("public" | "workspace" | "private" | "pii" | "phi" | "secret")[];
  readonly retention: "none" | "provider-policy" | "durable";
  readonly allowTraining: boolean;
  readonly region: string;
}

export interface ProviderReference {
  readonly providerId: string;
  readonly modelId?: string;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderPlugin>();

  register(plugin: ProviderPlugin): void {
    if (!/^[a-z][a-z0-9-]*$/.test(plugin.id)) throw new Error("provider id is invalid");
    if (this.providers.has(plugin.id)) throw new Error("duplicate provider id");
    if (plugin.listModels().some((model) => model.identity.provider !== plugin.id)) {
      throw new Error("provider model identity does not match provider id");
    }
    this.providers.set(plugin.id, plugin);
  }

  resolve(ref: ProviderReference): ProviderPlugin {
    const plugin = this.providers.get(ref.providerId);
    if (plugin === undefined) throw new Error("unknown provider");
    return plugin;
  }

  resolveModel(ref: Required<ProviderReference>): ModelIdentity {
    const plugin = this.resolve(ref);
    const model = plugin.listModels().find((entry) => entry.identity.id === ref.modelId);
    if (model === undefined) throw new Error("unknown model");
    return { ...model.identity };
  }

  requireCapabilities(plugin: ProviderPlugin, required: readonly ProviderCapability[]): void {
    for (const capability of required) {
      if (!plugin.capabilities.has(capability)) throw new Error("unsupported capability");
    }
  }

  requireDataPolicy(plugin: ProviderPlugin, required: GoalDataPolicy): void {
    const allowed = new Set(plugin.dataPolicy.allowedDataClasses);
    if (required.allowedDataClasses.some((dataClass) => !allowed.has(dataClass))) throw new Error("data policy disallows data class");
    if (required.allowTraining && !plugin.dataPolicy.trainsOnCustomerData) throw new Error("data policy training mismatch");
    if (required.retention === "durable" && plugin.dataPolicy.retention !== "durable") throw new Error("data policy retention mismatch");
    if (!plugin.dataPolicy.regions.includes(required.region)) throw new Error("data policy region mismatch");
  }

  listModels(): readonly ModelCatalogEntry[] {
    return [...this.providers.values()].flatMap((plugin) => plugin.listModels());
  }

  format(ref: Required<ProviderReference>): string {
    return formatModelRef(this.resolveModel(ref));
  }
}
