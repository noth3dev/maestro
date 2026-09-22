import { randomUUID } from "node:crypto";
import { certificationsConflict, type QualityVerdict } from "@maestro/domain";
import type { GoalLeaseProof } from "../commands.js";
import type { Pool, PoolClient } from "pg";
import { assertValidLeaseProofFor, lockGoalLease } from "./shared.js";
import { CertificationError, type CertificationConflictResolution, type ConflictCertificationRow } from "./types.js";

/** Reports whether the Goal's recorded certifications currently conflict (some passed, some failed/blocked). */
export async function detectCertificationConflict(pool: Pool, goalId: string): Promise<boolean> {
  const quality = await pool.query<{ verdict: QualityVerdict }>("SELECT verdict FROM quality_certifications WHERE goal_id = $1", [goalId]);
  const conditional = await pool.query<{ verdict: QualityVerdict }>("SELECT verdict FROM conditional_certifications WHERE goal_id = $1", [goalId]);
  return certificationsConflict([...quality.rows.map((row) => row.verdict), ...conditional.rows.map((row) => row.verdict)]);
}

function isCurrentCertification(row: ConflictCertificationRow, identity: { contractId: string; contractVersion: number; contractContentHash: string; revisionId: string; commitSha: string }): boolean {
  return row.contract_id === identity.contractId
    && Number(row.contract_version) === identity.contractVersion
    && row.contract_content_hash.trim() === identity.contractContentHash
    && row.integration_revision_id === identity.revisionId
    && row.integrated_commit_sha.trim() === identity.commitSha;
}

async function currentCertificationIdentity(pool: Pool, goalId: string): Promise<{ contractId: string; contractVersion: number; contractContentHash: string; revisionId: string; commitSha: string } | null> {
  const current = await pool.query<{ contract_id: string; version: string; content_hash: string; revision_id: string; commit_sha: string }>(
    `SELECT council.contract_id, contract.version, contract.content_hash, revision.revision_id, revision.commit_sha
       FROM head_councils council
       JOIN task_contracts contract ON contract.contract_id = council.contract_id
       JOIN goal_integration_revisions revision ON revision.goal_id = council.goal_id
      WHERE council.goal_id = $1 AND council.state = 'resolved'
      ORDER BY revision.revision_number DESC, council.created_at DESC
      LIMIT 1`, [goalId],
  );
  if (current.rowCount !== 1) return null;
  const row = current.rows[0]!;
  return { contractId: row.contract_id, contractVersion: Number(row.version), contractContentHash: row.content_hash.trim(), revisionId: row.revision_id, commitSha: row.commit_sha.trim() };
}

async function readConflictCertificationRows(pool: Pool, goalId: string): Promise<ConflictCertificationRow[]> {
  const result = await pool.query<ConflictCertificationRow>(
    `SELECT 'quality_certifications'::text AS certification_table, certification_id, verdict,
            contract_id, contract_version, contract_content_hash, integrated_commit_sha, integration_revision_id
       FROM quality_certifications WHERE goal_id = $1
     UNION ALL
     SELECT 'conditional_certifications'::text AS certification_table, certification_id, verdict,
            contract_id, contract_version, contract_content_hash, integrated_commit_sha, integration_revision_id
       FROM conditional_certifications WHERE goal_id = $1`, [goalId],
  );
  return result.rows;
}

/**
 * A resolution is valid only for the exact current certification identities
 * and exact immutable certification row set. Verdict text alone is never a
 * resolution, and a newest row cannot hide an unresolved disagreement.
 */
export async function isCertificationConflictResolved(
  pool: Pick<Pool | PoolClient, "query">,
  goalId: string,
  certificationIds: readonly string[],
  identity: { contractId: string; contractVersion: number; contractContentHash: string; revisionId: string; commitSha: string },
): Promise<boolean> {
  if (certificationIds.length === 0) return true;
  const wanted = new Set(certificationIds);
  const resolutions = await pool.query<{
    resolution_id: string; resolution_verdict: "proceed" | "do_not_proceed" | "escalate" | null;
    contract_id: string | null; contract_version: string | null; contract_content_hash: string | null;
    integration_revision_id: string | null; integrated_commit_sha: string | null;
  }>(
    `SELECT resolution_id, resolution_verdict, contract_id, contract_version, contract_content_hash,
            integration_revision_id, integrated_commit_sha
       FROM certification_conflict_resolutions
      WHERE goal_id = $1`, [goalId],
  );
  for (const resolution of resolutions.rows) {
    if (resolution.resolution_verdict !== "proceed" || resolution.contract_id !== identity.contractId || Number(resolution.contract_version) !== identity.contractVersion || resolution.contract_content_hash?.trim() !== identity.contractContentHash || resolution.integration_revision_id !== identity.revisionId || resolution.integrated_commit_sha?.trim() !== identity.commitSha) continue;
    const members = await pool.query<{ certification_id: string }>(
      `SELECT quality_certification_id AS certification_id FROM certification_conflict_resolution_members WHERE resolution_id = $1 AND quality_certification_id IS NOT NULL
       UNION ALL
       SELECT conditional_certification_id AS certification_id FROM certification_conflict_resolution_members WHERE resolution_id = $1 AND conditional_certification_id IS NOT NULL`, [resolution.resolution_id],
    );
    const actual = new Set(members.rows.map((member) => member.certification_id));
    if (actual.size === wanted.size && [...actual].every((id) => wanted.has(id))) return true;
  }
  return false;
}

/**
 * Routes a real conflicting certification set through an existing Encore
 * Council round. The database row names every immutable certification member,
 * captures the current contract/revision identity, and stores the Council's
 * actual synthesis verdict.
 */
export async function adjudicateCertificationConflict(pool: Pool, roundResult: { roundId: string }, goalId: string, conflictingVerdicts: readonly QualityVerdict[], proof: GoalLeaseProof): Promise<CertificationConflictResolution> {
  assertValidLeaseProofFor(goalId, proof);
  const round = await pool.query<{ goal_id: string; final_verdict: "proceed" | "do_not_proceed" | "escalate" }>(
    `SELECT round.goal_id, synthesis.final_verdict
       FROM encore_council_rounds round
       JOIN encore_council_syntheses synthesis ON synthesis.round_id = round.round_id
      WHERE round.round_id = $1`, [roundResult.roundId],
  );
  if (round.rowCount !== 1 || round.rows[0]!.goal_id !== goalId) throw new CertificationError("Encore Council round is not bound to this Goal");
  const actualRows = await readConflictCertificationRows(pool, goalId);
  const identity = await currentCertificationIdentity(pool, goalId);
  if (identity === null) throw new CertificationError("Cannot adjudicate a conflict without a current Goal integration identity");
  const currentRows = actualRows.filter((row) => isCurrentCertification(row, identity));
  const actualVerdicts = currentRows.map((row) => row.verdict);
  if (!certificationsConflict(actualVerdicts)) throw new CertificationError("No current certification conflict exists to adjudicate");
  if ([...conflictingVerdicts].sort().join(",") !== [...actualVerdicts].sort().join(",")) throw new CertificationError("Supplied conflict verdicts do not match the durable certification rows");

  const resolutionId = randomUUID();
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await lockGoalLease(client, proof);
    await client.query(
      `INSERT INTO certification_conflict_resolutions
        (resolution_id, goal_id, round_id, conflicting_verdicts, resolution_verdict,
         contract_id, contract_version, contract_content_hash, integration_revision_id, integrated_commit_sha)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)`,
      [resolutionId, goalId, roundResult.roundId, JSON.stringify(actualVerdicts), round.rows[0]!.final_verdict, identity.contractId, identity.contractVersion, identity.contractContentHash, identity.revisionId, identity.commitSha],
    );
    for (const row of currentRows) {
      await client.query(
        `INSERT INTO certification_conflict_resolution_members
          (member_id, resolution_id, quality_certification_id, conditional_certification_id)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), resolutionId, row.certification_table === "quality_certifications" ? row.certification_id : null, row.certification_table === "conditional_certifications" ? row.certification_id : null],
      );
    }
    await client.query("COMMIT"); open = false;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    if (error instanceof CertificationError) throw error;
    throw new CertificationError(error instanceof Error ? error.message : "Could not record certification conflict resolution");
  } finally {
    client.release();
  }
  return {
    resolutionId, goalId, roundId: roundResult.roundId, resolutionVerdict: round.rows[0]!.final_verdict,
    certificationIds: currentRows.map((row) => row.certification_id), contractId: identity.contractId,
    contractVersion: identity.contractVersion, contractContentHash: identity.contractContentHash,
    integrationRevisionId: identity.revisionId, integratedCommitSha: identity.commitSha,
  };
}
