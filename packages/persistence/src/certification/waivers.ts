import { randomUUID } from "node:crypto";
import { assertValidWaiverSubstance, type WaiverSubstance } from "@maestro/domain";
import type { GoalLeaseProof } from "../commands.js";
import type { Pool } from "pg";
import { assertValidLeaseProofFor, lockGoalLease, mapWaiver } from "./shared.js";
import { CertificationError, CertificationNotFoundError, type CertificationWaiver, type WaiverRow } from "./types.js";

/**
 * "A waived noncritical finding must record authority, reason, consequence,
 * expiry, and follow-up. Critical safety or correctness findings cannot be
 * waived merely to close the Goal." The critical-severity check is done
 * here, against the actual stored finding -- a caller cannot bypass it by
 * omitting or mislabeling the finding.
 */
export async function grantCertificationWaiver(
  pool: Pool,
  certificationTable: "quality_certifications" | "conditional_certifications",
  certificationId: string,
  findingId: string,
  substance: WaiverSubstance,
  grantedByActorId: string,
  proof: GoalLeaseProof,
): Promise<CertificationWaiver> {
  assertValidWaiverSubstance(substance);
  const table = certificationTable === "quality_certifications" ? "quality_certifications" : "conditional_certifications";
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const cert = await client.query<{ goal_id: string; findings: { findingId: string; severity: "critical" | "noncritical" }[] }>(
      `SELECT goal_id, findings FROM ${table} WHERE certification_id = $1`,
      [certificationId],
    );
    if (cert.rowCount !== 1) throw new CertificationNotFoundError(`Certification not found: ${certificationId}`);
    assertValidLeaseProofFor(cert.rows[0]!.goal_id, proof);
    await lockGoalLease(client, proof);
    const matchingFindings = cert.rows[0]!.findings.filter((candidate) => candidate.findingId === findingId);
    if (matchingFindings.length === 0) throw new CertificationError(`Finding not found on certification: ${findingId}`);
    if (matchingFindings.length > 1) throw new CertificationError(`Finding identity is ambiguous on certification: ${findingId}`);
    if (matchingFindings[0]!.severity === "critical") throw new CertificationError("A critical finding cannot be waived to close the Goal");
    const existing = await client.query<WaiverRow>(
      "SELECT waiver_id, certification_table, certification_id, finding_id, authority, reason FROM certification_waivers WHERE certification_table = $1 AND certification_id = $2 AND finding_id = $3",
      [certificationTable, certificationId, findingId],
    );
    if ((existing.rowCount ?? 0) > 0) { await client.query("COMMIT"); open = false; return mapWaiver(existing.rows[0]!); }
    const inserted = await client.query<WaiverRow>(
      `INSERT INTO certification_waivers (waiver_id, certification_table, certification_id, finding_id, authority, reason, consequence, follow_up, granted_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING waiver_id, certification_table, certification_id, finding_id, authority, reason`,
      [randomUUID(), certificationTable, certificationId, findingId, substance.authority, substance.reason, substance.consequence, substance.followUp, grantedByActorId, substance.expiresAt],
    );
    await client.query("COMMIT"); open = false;
    return mapWaiver(inserted.rows[0]!);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
