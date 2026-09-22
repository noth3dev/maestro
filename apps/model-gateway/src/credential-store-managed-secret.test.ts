import { describe, expect, it, vi } from "vitest";

const backingStore = new Map<string, string>();

vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: class {
    constructor(
      private readonly service: string,
      private readonly account: string,
    ) {}
    private key(): string {
      return `${this.service}\u0000${this.account}`;
    }
    async getPassword(): Promise<string | null> {
      return backingStore.get(this.key()) ?? null;
    }
    async setPassword(value: string): Promise<void> {
      backingStore.set(this.key(), value);
    }
    async deletePassword(): Promise<void> {
      backingStore.delete(this.key());
    }
  },
}));

import { KeychainCredentialStore } from "./credential-store.js";

describe("KeychainCredentialStore with a real secret on a managed-subscription binding", () => {
  it("round-trips a native-OAuth Codex credential (managed-subscription + real secret) across a simulated process restart", async () => {
    const service = `test-service-${crypto.randomUUID()}`;
    const accountRef = "openai-codex-operator-1";
    const secret = JSON.stringify({ accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 3_600_000, accountId: "acct-1" });

    const beforeRestart = new KeychainCredentialStore(service);
    await beforeRestart.bind({ operatorId: "operator-1", providerId: "openai-codex", authMode: "managed-subscription", accountRef }, secret);

    // A fresh instance has no in-memory cache, so this only succeeds if the
    // real persisted keychain value itself round-trips through validation.
    const afterRestart = new KeychainCredentialStore(service);
    const resolved = await afterRestart.resolveForGateway(accountRef);
    expect(resolved).toBe(secret);

    const listed = await afterRestart.list("operator-1");
    expect(listed).toEqual([{ bindingId: expect.any(String), operatorId: "operator-1", providerId: "openai-codex", authMode: "managed-subscription", accountRef }]);
  });

  it("does not let one corrupted managed credential break list() for the operator's other bindings", async () => {
    const service = `test-service-${crypto.randomUUID()}`;
    const store = new KeychainCredentialStore(service);
    await store.bind({ operatorId: "operator-1", providerId: "openai", authMode: "api-key", accountRef: "openai-operator-1" }, "sk-real-secret");
    await store.bindManaged!({ operatorId: "operator-1", providerId: "openai-codex", accountRef: "openai-codex-operator-1" });
    // Corrupt the second entry directly in the backing store, bypassing this store's own write path.
    backingStore.set(`${service}\u0000openai-codex-operator-1`, "not valid json");

    const fresh = new KeychainCredentialStore(service);
    const listed = await fresh.list("operator-1");

    expect(listed).toEqual([{ bindingId: expect.any(String), operatorId: "operator-1", providerId: "openai", authMode: "api-key", accountRef: "openai-operator-1" }]);
  });
});
