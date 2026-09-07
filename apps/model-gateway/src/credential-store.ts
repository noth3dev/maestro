import { randomUUID } from "node:crypto";
import type { ProviderAccountBinding, ProviderAuthMode } from "@maestro/agent-runtime";

export interface CredentialBinding extends ProviderAccountBinding {
  readonly bindingId: string;
  readonly operatorId: string;
}

interface StoredCredential extends CredentialBinding {
  readonly secret: string;
}

export interface CredentialStore {
  bind(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): Promise<CredentialBinding>;
  resolve(accountRef: string, operatorId: string, providerId: string): Promise<string>;
  metadata(accountRef: string): CredentialBinding | undefined;
  revoke(accountRef: string, operatorId: string): Promise<void>;
}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, StoredCredential>();

  async bind(input: { operatorId: string; providerId: string; authMode: ProviderAuthMode; accountRef?: string }, secret: string): Promise<CredentialBinding> {
    if (!secret) throw new Error("credential secret is required");
    const accountRef = input.accountRef ?? `account-${randomUUID()}`;
    const binding: StoredCredential = { bindingId: `credential-${randomUUID()}`, operatorId: input.operatorId, providerId: input.providerId, authMode: input.authMode, accountRef, secret };
    this.credentials.set(accountRef, binding);
    return this.publicBinding(binding);
  }

  async resolve(accountRef: string, operatorId: string, providerId: string): Promise<string> {
    const stored = this.credentials.get(accountRef);
    if (stored === undefined || stored.operatorId !== operatorId || stored.providerId !== providerId) throw new Error("credential binding is not owned by operator");
    return stored.secret;
  }

  /** Only provider adapters in this process may call this method. */
  async resolveForGateway(accountRef: string): Promise<string> {
    const stored = this.credentials.get(accountRef);
    if (stored === undefined) throw new Error("credential binding is unavailable");
    return stored.secret;
  }

  metadata(accountRef: string): CredentialBinding | undefined {
    const stored = this.credentials.get(accountRef);
    return stored === undefined ? undefined : this.publicBinding(stored);
  }

  async revoke(accountRef: string, operatorId: string): Promise<void> {
    const stored = this.credentials.get(accountRef);
    if (stored === undefined || stored.operatorId !== operatorId) throw new Error("credential binding is not owned by operator");
    this.credentials.delete(accountRef);
  }

  private publicBinding(stored: StoredCredential): CredentialBinding {
    const { secret: _secret, ...binding } = stored;
    return binding;
  }
}
