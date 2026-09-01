import { randomUUID } from "node:crypto";
import { assertValidDepartmentAcceptanceSubstance, assertValidQualityCertificationSubstance, type DepartmentAcceptanceSubstance, type QualityCertificationSubstance, type QualityVerdict } from "@maestro/domain";
import { isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "./council.js";
import type { Pool } from "pg";

export class CertificationError extends Error {}
export class CertificationNotFoundError extends CertificationError {}

export interface DepartmentAcceptance {
  readonly acceptanceId: string;
  readonly workerId: string;
  readonly commitSha: string;
  readonly reason: string;
  readonly acceptedBy: string;
}

interface AcceptanceRow { acceptance_id: string; worker_id: string; commit_sha: string; reason: string; accepted_by: string }
function mapAcceptance(row: AcceptanceRow): DepartmentAcceptance {
  return { acceptanceId: row.acceptance_id, workerId: row.worker_id, commitSha: row.commit_sha, reason: row.reason, acceptedBy: row.accepted_by };
}

async function assertAuthorizedDepartmentHead(pool: Pool, councilId: string, departmentId: string, context: CouncilActorContext): Promise<void> {
  const council = await readHeadCouncil(pool, councilId);
  const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
  if (captured === undefined) throw new CertificationError(`Department is not a captured Council participant: ${departmentId}`);
  const authorized = captured.headRoleId !== undefined
    ? isAuthorizedHeadCouncilActor(context, captured)
    : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
  if (!authorized) throw new CertificationError("Actor is not bound to the captured Head identity and session");
  const active = await pool.query(
    "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3",
    [council.goalId, departmentId, captured.sessionRef],
  );
  if (active.rowCount !== 1) throw new CertificationError("Captured Head session is no longer authorized");
}

/** The Executing Head accepts its own worker's output/integration. Requires the worker to have actually terminated successfully and have a real recorded integration commit. */
export async function acceptDepartmentWorkerOutput(pool: Pool, workerId: string, substance: DepartmentAcceptanceSubstance, context: CouncilActorContext): Promise<DepartmentAcceptance> {
  assertValidDepartmentAcceptanceSubstance(substance);
  const worker = await pool.query<{ council_id: string; department_id: string; status: string }>("SELECT council_id, department_id, status FROM workers WHERE worker_id = $1", [workerId]);
  if (worker.rowCount !== 1) throw new CertificationNotFoundError(`Worker not found: ${workerId}`);
  const { council_id: councilId, department_id: departmentId, status } = worker.rows[0]!;
  if (status !== "succeeded") throw new CertificationError("Only a worker that terminated successfully can be accepted");
  await assertAuthorizedDepartmentHead(pool, councilId, departmentId, context);
  const commit = await pool.query<{ commit_sha: string }>("SELECT commit_sha FROM integration_commits WHERE worker_id = $1 ORDER BY recorded_at DESC LIMIT 1", [workerId]);
  if (commit.rowCount !== 1) throw new CertificationError("Worker has no recorded integration commit to accept");
  const existing = await pool.query<AcceptanceRow>("SELECT acceptance_id, worker_id, commit_sha, reason, accepted_by FROM department_acceptances WHERE worker_id = $1", [workerId]);
  if ((existing.rowCount ?? 0) > 0) {
    const prior = existing.rows[0]!;
    if (prior.reason === substance.reason.trim()) return mapAcceptance(prior);
    throw new CertificationError("Worker output was already accepted with a different reason");
  }
  const inserted = await pool.query<AcceptanceRow>(
    `INSERT INTO department_acceptances (acceptance_id, worker_id, commit_sha, reason, accepted_by, session_ref)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING acceptance_id, worker_id, commit_sha, reason, accepted_by`,
    [randomUUID(), workerId, commit.rows[0]!.commit_sha, substance.reason.trim(), context.actorId, context.sessionRef],
  );
  return mapAcceptance(inserted.rows[0]!);
}

export interface QualityCertification {
  readonly certificationId: string;
  readonly goalId: string;
  readonly contractId: string;
  readonly contractVersion: number;
  readonly contractContentHash: string;
  readonly integratedCommitSha: string;
  readonly verdict: QualityVerdict;
  readonly certifiedByDepartment: string;
  readonly producingDepartment: string;
}

interface CertRow {
  certification_id: string; goal_id: string; contract_id: string; contract_version: string; contract_content_hash: string;
  integrated_commit_sha: string; verdict: QualityVerdict; certified_by_department: string; producing_department: string;
}
function mapCert(row: CertRow): QualityCertification {
  return {
    certificationId: row.certification_id, goalId: row.goal_id, contractId: row.contract_id, contractVersion: Number(row.contract_version),
    contractContentHash: row.contract_content_hash.trim(), integratedCommitSha: row.integrated_commit_sha, verdict: row.verdict,
    certifiedByDepartment: row.certified_by_department, producingDepartment: row.producing_department,
  };
}

/**
 * Quality independently certifies the integrated Goal revision against the
 * exact Task Contract identity. The certifying Department can never be the
 * same as the producing Department ("Producer cannot issue the independent
 * Quality certification"); it must itself be a captured, currently active
 * Council participant Head, not merely any caller.
 */
export async function certifyQuality(pool: Pool, workerId: string, substance: QualityCertificationSubstance, certifyingDepartmentId: string, context: CouncilActorContext): Promise<QualityCertification> {
  assertValidQualityCertificationSubstance(substance);
  const worker = await pool.query<{ council_id: string; department_id: string }>("SELECT council_id, department_id FROM workers WHERE worker_id = $1", [workerId]);
  if (worker.rowCount !== 1) throw new CertificationNotFoundError(`Worker not found: ${workerId}`);
  const { council_id: councilId, department_id: producingDepartment } = worker.rows[0]!;
  if (certifyingDepartmentId === producingDepartment) throw new CertificationError("The producing Department cannot issue its own Quality certification");
  const council = await readHeadCouncil(pool, councilId);
  await assertAuthorizedDepartmentHead(pool, councilId, certifyingDepartmentId, context);
  const commit = await pool.query<{ commit_sha: string }>("SELECT commit_sha FROM integration_commits WHERE worker_id = $1 ORDER BY recorded_at DESC LIMIT 1", [workerId]);
  if (commit.rowCount !== 1) throw new CertificationError("Worker has no recorded integration commit to certify");
  const contract = await pool.query<{ version: string; content_hash: string }>("SELECT version, content_hash FROM task_contracts WHERE contract_id = $1", [council.contractId]);
  if (contract.rowCount !== 1) throw new CertificationError("Task Contract not found for Quality certification");
  const project = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [council.goalId]);
  const durable = await pool.query<{ evidence_id: string; sha256: string }>("SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [council.goalId, project.rows[0]!.project_id]);
  const durableIds = new Set(durable.rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));
  for (const evidenceId of substance.testEvidenceIds) if (!durableIds.has(evidenceId.trim())) throw new CertificationError(`Quality certification test evidence is not durable: ${evidenceId}`);
  const inserted = await pool.query<CertRow>(
    `INSERT INTO quality_certifications (certification_id, goal_id, contract_id, contract_version, contract_content_hash, integrated_commit_sha, verdict, findings, test_evidence_ids, certified_by_department, producing_department)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
     RETURNING certification_id, goal_id, contract_id, contract_version, contract_content_hash, integrated_commit_sha, verdict, certified_by_department, producing_department`,
    [randomUUID(), council.goalId, council.contractId, contract.rows[0]!.version, contract.rows[0]!.content_hash, commit.rows[0]!.commit_sha, substance.verdict, JSON.stringify(substance.findings), JSON.stringify(substance.testEvidenceIds), certifyingDepartmentId, producingDepartment],
  );
  return mapCert(inserted.rows[0]!);
}

export async function listQualityCertifications(pool: Pool, goalId: string): Promise<readonly QualityCertification[]> {
  const result = await pool.query<CertRow>("SELECT certification_id, goal_id, contract_id, contract_version, contract_content_hash, integrated_commit_sha, verdict, certified_by_department, producing_department FROM quality_certifications WHERE goal_id = $1 ORDER BY created_at", [goalId]);
  return result.rows.map(mapCert);
}
