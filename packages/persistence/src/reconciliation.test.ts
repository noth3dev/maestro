import { describe, expect, it, vi } from "vitest";
import { StaleReconcilerLeaseError, renewReconcilerLeaderLease, type ReconcilerLeaseProof } from "./reconciliation.js";

const proof = (fencingToken: string): ReconcilerLeaseProof => ({
  ownerId: "reconciler-1",
  fencingToken,
});

describe("reconciler leader lease fencing token bounds", () => {
  it("accepts the PostgreSQL signed bigint maximum as a structurally valid token", async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ owner_id: "reconciler-1", fencing_token: "9223372036854775807" }],
    });
    const validProof = proof("9223372036854775807");

    await expect(renewReconcilerLeaderLease({ query } as never, validProof, 1_000)).resolves.toEqual(validProof);
    expect(query).toHaveBeenCalledOnce();
  });

  it.each(["9223372036854775808", "1".repeat(100)])(
    "rejects out-of-range token %s before a renewal query",
    async (fencingToken) => {
      const query = vi.fn();

      await expect(renewReconcilerLeaderLease({ query } as never, proof(fencingToken), 1_000))
        .rejects.toBeInstanceOf(StaleReconcilerLeaseError);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("rejects an empty owner id before a renewal query", async () => {
    const query = vi.fn();

    await expect(renewReconcilerLeaderLease({ query } as never, { ownerId: "", fencingToken: "1" }, 1_000))
      .rejects.toBeInstanceOf(StaleReconcilerLeaseError);
    expect(query).not.toHaveBeenCalled();
  });
});
