import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { grantCertificationWaiver, CertificationError } from "./certification.js";
import type { GoalLeaseProof } from "./commands.js";

const duplicateFindings = [
  { findingId: "same-finding", severity: "noncritical" as const },
  { findingId: "same-finding", severity: "critical" as const },
];

describe("Certification waiver guard", () => {
  it("rejects an ambiguous duplicate finding identity before granting a waiver", async () => {
    const goalId = "00000000-0000-0000-0000-000000000001";
    const proof: GoalLeaseProof = { goalId, ownerId: "test", fencingToken: "1" };
    // A hand-rolled client stub, not a real Pool: exercises grantCertificationWaiver's
    // pure validation order (fencing/control-latch checks pass on a genuinely
    // valid-looking lease and open Goal, then the ambiguous-finding guard still
    // fires) without a real PostgreSQL instance for this one fast unit case.
    const client = {
      query: async (sql: string) => {
        if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) return { rowCount: 0, rows: [] };
        if (sql.includes("SELECT goal_id, findings")) return { rowCount: 1, rows: [{ goal_id: goalId, findings: duplicateFindings }] };
        if (sql.includes("FROM goal_leases")) return { rowCount: 1, rows: [{ "?column?": 1 }] };
        if (sql.includes("pg_advisory_xact_lock")) return { rowCount: 0, rows: [] };
        if (sql.includes("SELECT project_id, state FROM goals")) return { rowCount: 1, rows: [{ project_id: "project-1", state: "active" }] };
        if (sql.includes("INSERT INTO goal_controls")) return { rowCount: 0, rows: [] };
        if (sql.includes("FROM goal_controls")) return { rowCount: 1, rows: [{ pause_requested_at: null, paused_at: null, stopping_at: null, stopped_at: null, emergency_stopped_at: null }] };
        throw new Error(`unexpected query: ${sql}`);
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;

    await expect(grantCertificationWaiver(
      pool,
      "quality_certifications",
      "certification-1",
      "same-finding",
      {
        authority: "ceo",
        reason: "not blocking",
        consequence: "tracked",
        followUp: "fix later",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      "sane",
      proof,
    )).rejects.toBeInstanceOf(CertificationError);
  });
});
