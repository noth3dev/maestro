import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveCredentialLimitError, authenticateLocalOperator, bootstrapLocalOperator, createLocalOperatorCredential, ACTIVE_CREDENTIAL_CAP } from "./auth.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("local operator credentials with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    for (const name of ["0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql"]) {
      const migration = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(migration);
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE local_operator_credentials, local_operators CASCADE");
  });

  afterAll(async () => { await pool.end(); });

  it("authenticates a bootstrapped operator without persisting its bearer secret", async () => {
    const secret = "test-bearer-secret-must-not-persist";
    const operatorId = randomUUID();
    const credentialId = randomUUID();
    const context = await bootstrapLocalOperator(pool, { operatorId, credentialId, secret });

    expect(context).toEqual({ operatorId, credentialId });
    await expect(authenticateLocalOperator(pool, secret)).resolves.toEqual({ outcome: "authenticated", operator: context });

    const stored = await pool.query<{ serialized: string }>("SELECT row_to_json(c)::text AS serialized FROM (SELECT * FROM local_operator_credentials) c");
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.serialized).not.toContain(secret);
  });

  it("returns forbidden for a revoked credential", async () => {
    const { credentialId } = await bootstrapLocalOperator(pool, { secret: "revoked-secret" });
    await pool.query("UPDATE local_operator_credentials SET active = false, revoked_at = transaction_timestamp() WHERE credential_id = $1", [credentialId]);

    await expect(authenticateLocalOperator(pool, "revoked-secret")).resolves.toEqual({ outcome: "forbidden" });
  });

  it("returns forbidden for a disabled operator", async () => {
    const { operatorId } = await bootstrapLocalOperator(pool, { secret: "disabled-secret" });
    await pool.query("UPDATE local_operators SET active = false WHERE operator_id = $1", [operatorId]);

    await expect(authenticateLocalOperator(pool, "disabled-secret")).resolves.toEqual({ outcome: "forbidden" });
  });

  it("does not allow credential identifiers to be reassigned", async () => {
    const { credentialId } = await bootstrapLocalOperator(pool, { secret: "immutable-secret" });
    await expect(pool.query("UPDATE local_operator_credentials SET operator_id = $1 WHERE credential_id = $2", [randomUUID(), credentialId]))
      .rejects.toThrow("local operator credential identifiers are immutable");
  });

  it("rejects direct reactivation of a revoked credential", async () => {
    const { credentialId } = await bootstrapLocalOperator(pool, { secret: "revocation-is-final" });
    await pool.query("UPDATE local_operator_credentials SET active = false, revoked_at = transaction_timestamp() WHERE credential_id = $1", [credentialId]);

    await expect(pool.query("UPDATE local_operator_credentials SET active = true, revoked_at = NULL WHERE credential_id = $1", [credentialId]))
      .rejects.toThrow("revoked local operator credentials cannot be reactivated");
  });

  it.each(["salt", "verifier"])("rejects direct %s replacement", async (column) => {
    const { credentialId } = await bootstrapLocalOperator(pool, { secret: "credential-material-is-final" });

    await expect(pool.query(`UPDATE local_operator_credentials SET ${column} = $1 WHERE credential_id = $2`, [Buffer.alloc(column === "salt" ? 16 : 64), credentialId]))
      .rejects.toThrow("local operator credential verifier material is immutable");
  });

  it("caps active credentials per operator and requires new credential creation for rotation", async () => {
    const context = await bootstrapLocalOperator(pool, { secret: "first-credential" });
    for (let count = 1; count < ACTIVE_CREDENTIAL_CAP; count += 1) {
      await createLocalOperatorCredential(pool, { operatorId: context.operatorId, secret: `credential-${count}` });
    }

    const deriveVerifier = vi.fn(async () => Buffer.alloc(64));
    await expect(createLocalOperatorCredential(pool, { operatorId: context.operatorId, secret: "too-many-credentials" }, { deriveVerifier }))
      .rejects.toBeInstanceOf(ActiveCredentialLimitError);
    expect(deriveVerifier).not.toHaveBeenCalled();
  });

  it("returns invalid for an unknown secret", async () => {
    await bootstrapLocalOperator(pool, { secret: "known-secret" });
    await expect(authenticateLocalOperator(pool, "wrong-secret")).resolves.toEqual({ outcome: "invalid" });
  });
});
