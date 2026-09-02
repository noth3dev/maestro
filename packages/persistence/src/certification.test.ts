import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { grantCertificationWaiver, CertificationError } from "./certification.js";

const duplicateFindings = [
  { findingId: "same-finding", severity: "noncritical" as const },
  { findingId: "same-finding", severity: "critical" as const },
];

describe("Certification waiver guard", () => {
  it("rejects an ambiguous duplicate finding identity before granting a waiver", async () => {
    const pool = {
      query: async (sql: string) => {
        if (sql.includes("SELECT findings")) return { rowCount: 1, rows: [{ findings: duplicateFindings }] };
        throw new Error(`unexpected query: ${sql}`);
      },
    } as unknown as Pool;

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
    )).rejects.toBeInstanceOf(CertificationError);
  });
});
