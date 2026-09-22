import type { QualityCertificationSubstance } from "@maestro/domain";
import type { EvidenceContentReader } from "@maestro/evidence";
import type { GoalLeaseProof } from "../commands.js";
import type { CouncilActorContext } from "../council.js";
import type { Pool } from "pg";
import { createCertification, mapConditionalCert } from "./shared.js";
import type { ConditionalCertification, ConditionalCertRow } from "./types.js";

/** Conditional certification is available only to its designated authority Department. */
export async function certifyConditional(pool: Pool, kind: "security" | "safety_compliance", workerId: string, substance: QualityCertificationSubstance, certifyingDepartmentId: string, proof: GoalLeaseProof, context: CouncilActorContext, content?: EvidenceContentReader): Promise<ConditionalCertification> {
  return await createCertification(pool, kind, workerId, substance, certifyingDepartmentId, proof, context, content) as ConditionalCertification;
}

export async function listConditionalCertifications(pool: Pool, goalId: string, kind?: "security" | "safety_compliance"): Promise<readonly ConditionalCertification[]> {
  const result = kind === undefined
    ? await pool.query<ConditionalCertRow>(`SELECT certification_id, kind, goal_id, contract_id, contract_version, contract_content_hash, integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id, verdict, certified_by_department, producing_department FROM conditional_certifications WHERE goal_id = $1 ORDER BY created_at, certification_id`, [goalId])
    : await pool.query<ConditionalCertRow>(`SELECT certification_id, kind, goal_id, contract_id, contract_version, contract_content_hash, integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id, verdict, certified_by_department, producing_department FROM conditional_certifications WHERE goal_id = $1 AND kind = $2 ORDER BY created_at, certification_id`, [goalId, kind]);
  return result.rows.filter((row) => row.worker_id !== null && row.integration_revision_id !== null).map(mapConditionalCert);
}
