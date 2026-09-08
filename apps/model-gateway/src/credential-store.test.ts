import { describe, expect, it, vi } from "vitest";

vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: class {
    async getPassword(): Promise<null> { return null; }
  },
}));

import { KeychainCredentialStore } from "./credential-store.js";

describe("KeychainCredentialStore on an empty OS keyring", () => {
  it("treats a null index entry as no credentials", async () => {
    await expect(new KeychainCredentialStore("empty-keyring").list("local-operator")).resolves.toEqual([]);
  });

  it("treats a null account entry as an absent credential", async () => {
    await expect(new KeychainCredentialStore("empty-keyring").ensure("account-1")).resolves.toBeUndefined();
  });
});
