import { describe, expect, it, vi } from "vitest";
import { MAX_BEARER_SECRET_BYTES, ScryptConcurrencyGuard, authenticateLocalOperator } from "./auth.js";

const row = {
  operator_id: "operator", credential_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06", operator_active: true, credential_active: true,
  revoked_at: null, salt: Buffer.alloc(16), verifier: Buffer.alloc(64),
};

describe("local operator auth CPU bounds", () => {
  it("rejects an oversized bearer secret before database or KDF work", async () => {
    const query = vi.fn();
    const deriveVerifier = vi.fn();
    const pool = { query } as never;

    await expect(authenticateLocalOperator(pool, `${row.credential_id}.${"x".repeat(MAX_BEARER_SECRET_BYTES + 1)}`, { deriveVerifier }))
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

    await expect(authenticateLocalOperator(pool, `${row.credential_id}.valid-length-secret`, { scryptGuard: guard, deriveVerifier }))
      .resolves.toEqual({ outcome: "unavailable" });
    expect(query).toHaveBeenCalledOnce();
    expect(deriveVerifier).not.toHaveBeenCalled();
    release?.();
  });

  it("looks up the credential selector before deriving the verifier", async () => {
    const credentialId = row.credential_id;
    const query = vi.fn(async () => ({ rows: [{ ...row, credential_id: credentialId }] }));
    const deriveVerifier = vi.fn(async () => Buffer.alloc(64));
    const pool = { query } as never;

    await expect(authenticateLocalOperator(pool, `${credentialId}.valid.length-secret`, { deriveVerifier }))
      .resolves.toEqual({ outcome: "authenticated", operator: { operatorId: row.operator_id, credentialId } });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE c.credential_id = $1"), [credentialId]);
    expect(deriveVerifier).toHaveBeenCalledWith("valid.length-secret", row.salt);
    expect(deriveVerifier).toHaveBeenCalledOnce();
  });
  it("does not derive for an unknown credential selector", async () => {
    const credentialId = "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f07";
    const query = vi.fn(async () => ({ rows: [] }));
    const deriveVerifier = vi.fn();
    const pool = { query } as never;

    await expect(authenticateLocalOperator(pool, `${credentialId}.unknown-secret`, { deriveVerifier })).resolves.toEqual({ outcome: "invalid" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE c.credential_id = $1"), [credentialId]);
    expect(deriveVerifier).not.toHaveBeenCalled();
  });

  it.each(["raw-secret", "not-a-uuid.secret", `${row.credential_id}`, `${row.credential_id}.`])("rejects an unstructured bearer token before lookup: %s", async (bearerToken) => {
    const query = vi.fn();
    const deriveVerifier = vi.fn();
    const pool = { query } as never;

    await expect(authenticateLocalOperator(pool, bearerToken, { deriveVerifier })).resolves.toEqual({ outcome: "invalid" });
    expect(query).not.toHaveBeenCalled();
    expect(deriveVerifier).not.toHaveBeenCalled();
  });

});
