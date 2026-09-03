import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import fc from "fast-check";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  acquireReconcilerLeaderLease,
  renewReconcilerLeaderLease,
  StaleReconcilerLeaseError,
  type ReconcilerLeaseProof,
} from "./reconciliation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

/**
 * A fencing token that is structurally valid (matches isValidFencingToken's
 * exact base-10 bigint bounds) but is not the current lease row's token.
 */
const arbitraryForgedFencingToken = fc
  .bigInt({ min: 1n, max: 9223372036854775807n })
  .map((value) => value.toString());

const arbitraryText = fc.stringMatching(/^[a-zA-Z0-9-]{1,32}$/);

async function currentLeaseRow(pool: Pool): Promise<{ owner_id: string; fencing_token: string; expires_at: Date } | undefined> {
  const result = await pool.query<{ owner_id: string; fencing_token: string; expires_at: Date }>(
    "SELECT owner_id, fencing_token, expires_at FROM reconciler_leader_lease WHERE lease_key = 'singleton'",
  );
  return result.rows[0];
}

describeDatabase("reconciler leader lease fencing property tests with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => { await applyAllMigrations(pool); });

  beforeEach(async () => {
    await pool.query("TRUNCATE reconciler_leader_lease");
  });

  afterAll(async () => { await pool.end(); });

  it("rejects every generated stale/forged-token renewal without extending expiry or changing the owner/token (Phase 1 re-patch item 5)", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryForgedFencingToken, arbitraryText, async (forgedToken, ownerSuffix) => {
        // The reconciler lease is a fixed singleton row shared by every
        // property iteration (unlike Goal leases, keyed by a fresh
        // randomUUID() per iteration); reset it before each iteration so an
        // earlier iteration's still-unexpired lease never blocks this one.
        await pool.query("TRUNCATE reconciler_leader_lease");
        const owner = `owner-${ownerSuffix}`;
        const current = await acquireReconcilerLeaderLease(pool, owner, 60_000);
        fc.pre(forgedToken !== current.fencingToken);

        const before = await currentLeaseRow(pool);
        const forgedProof: ReconcilerLeaseProof = { ownerId: owner, fencingToken: forgedToken };
        await expect(renewReconcilerLeaderLease(pool, forgedProof, 60_000)).rejects.toBeInstanceOf(StaleReconcilerLeaseError);

        const after = await currentLeaseRow(pool);
        expect(after).toEqual(before);

        // The real current proof still works afterward: forging did not corrupt the lease.
        await expect(renewReconcilerLeaderLease(pool, current, 60_000)).resolves.toMatchObject({ ownerId: owner, fencingToken: current.fencingToken });
      }),
      { numRuns: 25 },
    );
  });

  it("rejects a wrong-owner proof at the current token without extending expiry, changing the owner, or changing the token", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryText, arbitraryText, async (ownerSuffix, wrongOwnerSuffix) => {
        await pool.query("TRUNCATE reconciler_leader_lease");
        const owner = `owner-${ownerSuffix}`;
        const wrongOwner = `not-${wrongOwnerSuffix}`;
        fc.pre(wrongOwner !== owner);
        const current = await acquireReconcilerLeaderLease(pool, owner, 60_000);

        const before = await currentLeaseRow(pool);
        const wrongOwnerProof: ReconcilerLeaseProof = { ownerId: wrongOwner, fencingToken: current.fencingToken };
        await expect(renewReconcilerLeaderLease(pool, wrongOwnerProof, 60_000)).rejects.toBeInstanceOf(StaleReconcilerLeaseError);

        const after = await currentLeaseRow(pool);
        expect(after).toEqual(before);
      }),
      { numRuns: 25 },
    );
  });

  it("rejects an old proof after expiry and successor acquisition (takeover), leaving the successor's token and expiry unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(arbitraryText, arbitraryText, async (firstOwnerSuffix, secondOwnerSuffix) => {
        await pool.query("TRUNCATE reconciler_leader_lease");
        const firstOwner = `owner-a-${firstOwnerSuffix}`;
        const secondOwner = `owner-b-${secondOwnerSuffix}`;
        fc.pre(firstOwner !== secondOwner);

        // A lease that already expired lets a successor acquire (steal) it.
        const expired = await acquireReconcilerLeaderLease(pool, firstOwner, 1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const successor = await acquireReconcilerLeaderLease(pool, secondOwner, 60_000);
        expect(successor.fencingToken).not.toBe(expired.fencingToken);
        expect(successor.ownerId).toBe(secondOwner);

        const before = await currentLeaseRow(pool);
        // The old (pre-takeover) proof must never renew, even though its
        // token was genuinely valid before the takeover.
        await expect(renewReconcilerLeaderLease(pool, expired, 60_000)).rejects.toBeInstanceOf(StaleReconcilerLeaseError);

        const after = await currentLeaseRow(pool);
        expect(after).toEqual(before);
        expect(after?.owner_id).toBe(secondOwner);
        expect(after?.fencing_token).toBe(successor.fencingToken);
      }),
      { numRuns: 15 },
    );
  });
});
