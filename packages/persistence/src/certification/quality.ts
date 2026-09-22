import type { QualityCertificationSubstance } from "@maestro/domain";
import type { EvidenceContentReader } from "@maestro/evidence";
import type { GoalLeaseProof } from "../commands.js";
import type { CouncilActorContext } from "../council.js";
import type { Pool } from "pg";
import { createCertification, mapCert } from "./shared.js";
import type { CertRow, QualityCertification } from "./types.js";

/** Quality is an independent Department path; it cannot be replaced by Security or Safety authority. */
export async function certifyQuality(pool: Pool, workerId: string, substance: QualityCertificationSubstance, certifyingDepartmentId: string, proof: GoalLeaseProof, context: CouncilActorContext, content?: EvidenceContentReader): Promise<QualityCertification> {
  return await createCertification(pool, "quality", workerId, substance, certifyingDepartmentId, proof, context, content) as QualityCertification;
}

export async function listQualityCertifications(pool: Pool, goalId: string): Promise<readonly QualityCertification[]> {
  const result = await pool.query<CertRow>(
    `SELECT certification_id, goal_id, contract_id, contract_version, contract_content_hash,
      integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
      verdict, certified_by_department, producing_department
       FROM quality_certifications WHERE goal_id = $1 ORDER BY created_at, certification_id`, [goalId],
  );
  return result.rows.filter((row) => row.worker_id !== null && row.integration_revision_id !== null).map(mapCert);
}
