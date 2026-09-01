import { describe, expect, it, vi } from "vitest";
import { MAX_BEARER_SECRET_BYTES, ScryptConcurrencyGuard, authenticateLocalOperator } from "./auth.js";

const row = {
  operator_id: "operator", credential_id: "credential", operator_active: true, credential_active: true,
  revoked_at: null, salt: Buffer.alloc(16), verifier: Buffer.alloc(64),
};

describe("local operator auth CPU bounds", () => {
  it("rejects an oversized bearer secret before database or KDF work", async () => {
    const query = vi.fn();
    const deriveVerifier = vi.fn();
    const pool = { query } as never;

    await expect(authenticateLocalOperator(pool, "x".repeat(MAX_BEARER_SECRET_BYTES + 1), { deriveVerifier }))
      .resolves.toEqual({ outcome: "invalid" });
    expect(query).not.toHaveBeenCalled();
    expect(deriveVerifier).not.toHaveBeenCalled();
  });

  it("fails closed when the bounded scrypt guard is saturated before KDF work", async () => {
    const guard = new ScryptConcurrencyGuard(1);
    const release = guard.tryAcquire();
    const query = vi.fn(async () => ({ rows: [row] }));
    const deriveVerifier = vi.fn(async () => Buffer.alloc(64));
    const pool = { query } as never;

    await expect(authenticateLocalOperator(pool, "valid-length-secret", { scryptGuard: guard, deriveVerifier }))
      .resolves.toEqual({ outcome: "unavailable" });
    expect(query).not.toHaveBeenCalled();
    expect(deriveVerifier).not.toHaveBeenCalled();
    release?.();
  });
});
