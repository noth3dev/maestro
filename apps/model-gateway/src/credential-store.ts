import { randomUUID } from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";
import type { ProviderAccountBinding, ProviderAuthMode } from "@maestro/agent-runtime";

export interface CredentialBinding extends ProviderAccountBinding {
  readonly bindingId: string;
  readonly operatorId: string;
}

interface StoredCredential extends CredentialBinding {
  readonly secret: string;
}

export interface CredentialStore {
  /** Persist a provider secret in the gateway-owned secure store. */
  bind(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): Promise<CredentialBinding>;
  /** Register a process-provided secret without copying it to the secure store. */
  bindEphemeral?(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): Promise<CredentialBinding>;
  resolve(accountRef: string, operatorId: string, providerId: string): Promise<string>;
  /** Hydrate one known account from the gateway-owned secure store. */
  ensure(accountRef: string): Promise<CredentialBinding | undefined>;
  /** List active binding metadata for one gateway operator; never returns secrets. */
  list(operatorId: string): Promise<readonly CredentialBinding[]>;
  metadata(accountRef: string): CredentialBinding | undefined;
  revoke(accountRef: string, operatorId: string): Promise<void>;
  /** Only provider adapters in this process may call this method. */
  resolveForGateway(accountRef: string): Promise<string>;
}

function publicBinding(stored: StoredCredential): CredentialBinding {
  const { secret: _secret, ...binding } = stored;
  return binding;
}

function createBinding(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): StoredCredential {
  if (secret.trim() === "") throw new Error("credential secret is required");
  return {
    bindingId: `credential-${randomUUID()}`,
    operatorId: input.operatorId,
    providerId: input.providerId,
    authMode: input.authMode,
    accountRef: input.accountRef ?? `account-${randomUUID()}`,
    secret,
  };
}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, StoredCredential>();

  async bind(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): Promise<CredentialBinding> {
    const binding = createBinding(input, secret);
    this.credentials.set(binding.accountRef, binding);
    return publicBinding(binding);
  }

  async bindEphemeral(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): Promise<CredentialBinding> {
    return this.bind(input, secret);
  }

  async resolve(accountRef: string, operatorId: string, providerId: string): Promise<string> {
    const stored = this.credentials.get(accountRef);
    if (stored === undefined || stored.operatorId !== operatorId || stored.providerId !== providerId) throw new Error("credential binding is not owned by operator");
    return stored.secret;
  }

  async ensure(accountRef: string): Promise<CredentialBinding | undefined> {
    const stored = this.credentials.get(accountRef);
    return stored === undefined ? undefined : publicBinding(stored);
  }

  async resolveForGateway(accountRef: string): Promise<string> {
    const stored = this.credentials.get(accountRef);
    if (stored === undefined) throw new Error("credential binding is unavailable");
    return stored.secret;
  }

  async list(operatorId: string): Promise<readonly CredentialBinding[]> {
    return [...this.credentials.values()]
      .filter((stored) => stored.operatorId === operatorId)
      .map(publicBinding);
  }

  metadata(accountRef: string): CredentialBinding | undefined {
    const stored = this.credentials.get(accountRef);
    return stored === undefined ? undefined : publicBinding(stored);
  }

  async revoke(accountRef: string, operatorId: string): Promise<void> {
    const stored = this.credentials.get(accountRef);
    if (stored === undefined || stored.operatorId !== operatorId) throw new Error("credential binding is not owned by operator");
    this.credentials.delete(accountRef);
  }
}

/**
 * Gateway-owned credential storage. Only the gateway process can read the
 * keychain value; callers receive metadata and an opaque account reference.
 */
export class KeychainCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, StoredCredential>();

  private readonly indexAccount = "__maestro_binding_index__";

  constructor(private readonly service = "maestro-model-gateway") {}

  async bind(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): Promise<CredentialBinding> {
    const binding = createBinding(input, secret);
    await this.write(binding);
    this.credentials.set(binding.accountRef, binding);
    await this.writeIndex();
    return publicBinding(binding);
  }

  async bindEphemeral(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): Promise<CredentialBinding> {
    const binding = createBinding(input, secret);
    this.credentials.set(binding.accountRef, binding);
    return publicBinding(binding);
  }

  async ensure(accountRef: string): Promise<CredentialBinding | undefined> {
    const cached = this.credentials.get(accountRef);
    if (cached !== undefined) return publicBinding(cached);
    let value: string | undefined;
    try {
      value = await new AsyncEntry(this.service, accountRef).getPassword();
    } catch {
      throw new Error("gateway credential store is unavailable");
    }
    if (value === undefined || value.trim() === "") return undefined;
    const stored = parseStoredCredential(value);
    this.credentials.set(accountRef, stored);
    return publicBinding(stored);
  }

  async resolve(accountRef: string, operatorId: string, providerId: string): Promise<string> {
    const stored = await this.get(accountRef);
    if (stored === undefined || stored.operatorId !== operatorId || stored.providerId !== providerId) throw new Error("credential binding is not owned by operator");
    return stored.secret;
  }

  async resolveForGateway(accountRef: string): Promise<string> {
    const stored = await this.get(accountRef);
    if (stored === undefined) throw new Error("credential binding is unavailable");
    return stored.secret;
  }

  async list(operatorId: string): Promise<readonly CredentialBinding[]> {
    const cached = [...this.credentials.values()].filter((binding) => binding.operatorId === operatorId);
    let index: readonly CredentialBinding[];
    try {
      index = await this.readIndex();
    } catch (error) {
      // Environment-provided credentials are intentionally process-local and
      // must remain usable even when the host keychain is unavailable.
      if (cached.length > 0) return cached.map(publicBinding);
      throw error;
    }
    const active: CredentialBinding[] = [...cached.map(publicBinding)];
    const cachedRefs = new Set(cached.map((binding) => binding.accountRef));
    for (const binding of index) {
      if (binding.operatorId !== operatorId || cachedRefs.has(binding.accountRef)) continue;
      const hydrated = await this.ensure(binding.accountRef);
      if (hydrated !== undefined && hydrated.operatorId === operatorId) active.push(hydrated);
    }
    return active;
  }

  metadata(accountRef: string): CredentialBinding | undefined {
    const stored = this.credentials.get(accountRef);
    return stored === undefined ? undefined : publicBinding(stored);
  }

  async revoke(accountRef: string, operatorId: string): Promise<void> {
    const stored = await this.get(accountRef);
    if (stored === undefined || stored.operatorId !== operatorId) throw new Error("credential binding is not owned by operator");
    try {
      await new AsyncEntry(this.service, accountRef).deletePassword();
    } catch {
      throw new Error("gateway credential store is unavailable");
    }
    this.credentials.delete(accountRef);
    await this.writeIndex();
  }

  private async get(accountRef: string): Promise<StoredCredential | undefined> {
    await this.ensure(accountRef);
    return this.credentials.get(accountRef);
  }

  private async readIndex(): Promise<readonly CredentialBinding[]> {
    let value: string | undefined;
    try {
      value = await new AsyncEntry(this.service, this.indexAccount).getPassword();
    } catch {
      throw new Error("gateway credential store is unavailable");
    }
    if (value === undefined || value.trim() === "") return [];
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("invalid index");
      return parsed.map((item) => {
        if (!item || typeof item !== "object") throw new Error("invalid index entry");
        const binding = item as Partial<CredentialBinding>;
        if (typeof binding.bindingId !== "string" || typeof binding.operatorId !== "string" || typeof binding.providerId !== "string" || (binding.authMode !== "api-key" && binding.authMode !== "managed-subscription") || typeof binding.accountRef !== "string") throw new Error("invalid index entry");
        return binding as CredentialBinding;
      });
    } catch {
      throw new Error("gateway credential store contains invalid metadata");
    }
  }

  private async writeIndex(): Promise<void> {
    try {
      const bindings = [...this.credentials.values()].map(publicBinding);
      await new AsyncEntry(this.service, this.indexAccount).setPassword(JSON.stringify(bindings));
    } catch {
      throw new Error("gateway credential store is unavailable");
    }
  }

  private async write(binding: StoredCredential): Promise<void> {
    try {
      await new AsyncEntry(this.service, binding.accountRef).setPassword(JSON.stringify(binding));
    } catch {
      throw new Error("gateway credential store is unavailable");
    }
  }
}

function parseStoredCredential(value: string): StoredCredential {
  try {
    const parsed = JSON.parse(value) as Partial<StoredCredential>;
    if (
      typeof parsed.bindingId !== "string" ||
      typeof parsed.operatorId !== "string" ||
      typeof parsed.providerId !== "string" ||
      (parsed.authMode !== "api-key" && parsed.authMode !== "managed-subscription") ||
      typeof parsed.accountRef !== "string" ||
      typeof parsed.secret !== "string" ||
      parsed.secret.trim() === ""
    ) throw new Error("invalid credential");
    return parsed as StoredCredential;
  } catch {
    throw new Error("gateway credential store contains invalid metadata");
  }
}
