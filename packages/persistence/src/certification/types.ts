import type { QualityVerdict } from "@maestro/domain";

export class CertificationError extends Error {}
export class CertificationNotFoundError extends CertificationError {}

export interface DepartmentAcceptance {
  readonly acceptanceId: string;
  readonly workerId: string;
  readonly commitSha: string;
  readonly reason: string;
  readonly acceptedBy: string;
}

export interface QualityCertification {
  readonly certificationId: string;
  readonly goalId: string;
  readonly contractId: string;
  readonly contractVersion: number;
  readonly contractContentHash: string;
  readonly integratedCommitSha: string;
  readonly workerId: string;
  readonly departmentAcceptanceId: string;
  readonly integrationRevisionId: string;
  readonly verdict: QualityVerdict;
  readonly certifiedByDepartment: string;
  readonly producingDepartment: string;
}

export interface ConditionalCertification {
  readonly certificationId: string;
  readonly kind: "security" | "safety_compliance";
  readonly goalId: string;
  readonly contractId: string;
  readonly contractVersion: number;
  readonly contractContentHash: string;
  readonly integratedCommitSha: string;
  readonly workerId: string;
  readonly departmentAcceptanceId: string;
  readonly integrationRevisionId: string;
  readonly verdict: QualityVerdict;
  readonly certifiedByDepartment: string;
  readonly producingDepartment: string;
}

export interface CertificationWaiver {
  readonly waiverId: string;
  readonly certificationTable: "quality_certifications" | "conditional_certifications";
  readonly certificationId: string;
  readonly findingId: string;
  readonly authority: string;
  readonly reason: string;
}

export interface CertificationConflictResolution {
  readonly resolutionId: string;
  readonly goalId: string;
  readonly roundId: string;
  readonly resolutionVerdict: "proceed" | "do_not_proceed" | "escalate";
  readonly certificationIds: readonly string[];
  readonly contractId: string;
  readonly contractVersion: number;
  readonly contractContentHash: string;
  readonly integrationRevisionId: string;
  readonly integratedCommitSha: string;
}

export type CertificationKind = "quality" | "security" | "safety_compliance";

export interface CertificationLineage {
  readonly goalId: string;
  readonly councilId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly contractContentHash: string;
  readonly integratedCommitSha: string;
  readonly workerId: string;
  readonly producingDepartment: string;
  readonly departmentAcceptanceId: string;
  readonly integrationRevisionId: string;
}

export interface AcceptanceRow { acceptance_id: string; worker_id: string; commit_sha: string; reason: string; accepted_by: string }

export interface CertRow {
  certification_id: string; goal_id: string; contract_id: string; contract_version: string; contract_content_hash: string;
  integrated_commit_sha: string; worker_id: string; department_acceptance_id: string; integration_revision_id: string;
  verdict: QualityVerdict; findings: unknown[]; test_evidence_ids: unknown[]; certified_by_department: string; producing_department: string;
}

export interface ConditionalCertRow {
  certification_id: string; kind: "security" | "safety_compliance"; goal_id: string; contract_id: string;
  contract_version: string; contract_content_hash: string; integrated_commit_sha: string;
  worker_id: string; department_acceptance_id: string; integration_revision_id: string;
  verdict: QualityVerdict; findings: unknown[]; test_evidence_ids: unknown[]; certified_by_department: string; producing_department: string;
}

export interface WaiverRow {
  waiver_id: string; certification_table: "quality_certifications" | "conditional_certifications"; certification_id: string;
  finding_id: string; authority: string; reason: string;
}

export interface ConflictCertificationRow {
  certification_table: "quality_certifications" | "conditional_certifications";
  certification_id: string;
  verdict: QualityVerdict;
  contract_id: string;
  contract_version: string;
  contract_content_hash: string;
  integrated_commit_sha: string;
  integration_revision_id: string | null;
}
