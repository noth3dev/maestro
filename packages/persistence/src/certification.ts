import { randomUUID } from "node:crypto";
import { assertValidDepartmentAcceptanceSubstance, assertValidQualityCertificationSubstance, assertValidWaiverSubstance, certificationsConflict, type DepartmentAcceptanceSubstance, type QualityCertificationSubstance, type QualityVerdict, type WaiverSubstance } from "@maestro/domain";
import { verifyEvidenceRecord, type EvidenceContentReader } from "@maestro/evidence";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "./council.js";
import type { Pool, PoolClient } from "pg";

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

async function assertAuthorizedDepartmentHead(pool: Pool, councilId: string, departmentId: string, context: CouncilActorContext, councilOverride?: Awaited<ReturnType<typeof readHeadCouncil>>): Promise<void> {
  const council = councilOverride ?? await readHeadCouncil(pool, councilId);
  const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
  if (captured === undefined) throw new CertificationError(`Department is not a captured Council participant: ${departmentId}`);
  const authorized = captured.headRoleId !== undefined
    ? isAuthorizedHeadCouncilActor(context, captured)
    : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
  if (!authorized) throw new CertificationError("Actor is not bound to the captured Head identity and session");
  const active = await pool.query(
    "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND contract_id = $3 AND head_role_id = $4 AND status = 'active' AND active_session_ref = $5",
    [council.goalId, departmentId, council.contractId, captured.headRoleId ?? captured.participantId, captured.sessionRef],
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
  // check-then-insert on worker_id alone would race two concurrent callers
  // for the same worker straight into the DB's UNIQUE (worker_id)
  // constraint, surfacing a raw Postgres error instead of this codebase's
  // usual idempotent-return pattern. INSERT ... ON CONFLICT DO NOTHING makes
  // the insert itself the atomic check, and a real conflict re-reads the
  // now-durable row instead of throwing.
  const inserted = await pool.query<AcceptanceRow>(
    `INSERT INTO department_acceptances (acceptance_id, worker_id, commit_sha, reason, accepted_by, session_ref)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (worker_id) DO NOTHING
     RETURNING acceptance_id, worker_id, commit_sha, reason, accepted_by`,
    [randomUUID(), workerId, commit.rows[0]!.commit_sha, substance.reason.trim(), context.actorId, context.sessionRef],
  );
  if ((inserted.rowCount ?? 0) > 0) return mapAcceptance(inserted.rows[0]!);
  const existing = await pool.query<AcceptanceRow>("SELECT acceptance_id, worker_id, commit_sha, reason, accepted_by FROM department_acceptances WHERE worker_id = $1", [workerId]);
  if ((existing.rowCount ?? 0) !== 1) throw new CertificationError("Worker output acceptance could not be resolved after a concurrent insert");
  const prior = existing.rows[0]!;
  if (prior.reason === substance.reason.trim()) return mapAcceptance(prior);
  throw new CertificationError("Worker output was already accepted with a different reason");
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

interface CertRow {
  certification_id: string; goal_id: string; contract_id: string; contract_version: string; contract_content_hash: string;
  integrated_commit_sha: string; worker_id: string; department_acceptance_id: string; integration_revision_id: string;
  verdict: QualityVerdict; certified_by_department: string; producing_department: string;
}
function mapCert(row: CertRow): QualityCertification {
  return {
    certificationId: row.certification_id, goalId: row.goal_id, contractId: row.contract_id, contractVersion: Number(row.contract_version),
    contractContentHash: row.contract_content_hash.trim(), integratedCommitSha: row.integrated_commit_sha.trim(),
    workerId: row.worker_id, departmentAcceptanceId: row.department_acceptance_id, integrationRevisionId: row.integration_revision_id,
    verdict: row.verdict, certifiedByDepartment: row.certified_by_department, producingDepartment: row.producing_department,
  };
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

interface ConditionalCertRow {
  certification_id: string; kind: "security" | "safety_compliance"; goal_id: string; contract_id: string;
  contract_version: string; contract_content_hash: string; integrated_commit_sha: string;
  worker_id: string; department_acceptance_id: string; integration_revision_id: string;
  verdict: QualityVerdict; certified_by_department: string; producing_department: string;
}
function mapConditionalCert(row: ConditionalCertRow): ConditionalCertification {
  return {
    certificationId: row.certification_id, kind: row.kind, goalId: row.goal_id, contractId: row.contract_id,
    contractVersion: Number(row.contract_version), contractContentHash: row.contract_content_hash.trim(), integratedCommitSha: row.integrated_commit_sha.trim(),
    workerId: row.worker_id, departmentAcceptanceId: row.department_acceptance_id, integrationRevisionId: row.integration_revision_id,
    verdict: row.verdict, certifiedByDepartment: row.certified_by_department, producingDepartment: row.producing_department,
  };
}

type CertificationKind = "quality" | "security" | "safety_compliance";
interface CertificationLineage {
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

/**
 * Read and lock every identity fact needed by a certification.  In particular,
 * the accepted commit and the frozen Goal revision come from durable rows;
 * callers cannot supply a SHA or a contract version to certify.
 */
/** A valid lease alone does not authorize a certification write once a Goal is paused, stopping, stopped, or emergency-stopped -- same invariant every other Phase 2/3 write module enforces. */
async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 33))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

function assertValidLeaseProofFor(goalId: string, proof: GoalLeaseProof): void {
  if (goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
}

async function readCertificationLineage(
  pool: Pool,
  kind: CertificationKind,
  workerId: string,
  certifyingDepartmentId: string,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
): Promise<{ lineage: CertificationLineage; client: PoolClient; council: Awaited<ReturnType<typeof readHeadCouncil>> }> {
  const worker = await pool.query<{ council_id: string; department_id: string }>("SELECT council_id, department_id FROM workers WHERE worker_id = $1", [workerId]);
  if (worker.rowCount !== 1) throw new CertificationNotFoundError(`Worker not found: ${workerId}`);
  const { council_id: councilId, department_id: producingDepartment } = worker.rows[0]!;
  if (kind === "quality" && certifyingDepartmentId !== "quality") throw new CertificationError("Quality certification requires the Quality Department authority");
  const requiredAuthority = kind === "safety_compliance" ? "safety-compliance" : kind;
  if (certifyingDepartmentId !== requiredAuthority) throw new CertificationError(`${kind} certification requires the ${requiredAuthority} Department authority`);
  if (certifyingDepartmentId === producingDepartment) throw new CertificationError(`The producing Department cannot issue its own ${kind} certification`);
  const council = await readHeadCouncil(pool, councilId);
  assertValidLeaseProofFor(council.goalId, proof);
  await assertAuthorizedDepartmentHead(pool, councilId, certifyingDepartmentId, context, council);

  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await lockGoalLease(client, proof);
    const lockedWorker = await client.query<{ council_id: string; department_id: string; status: string }>(
      "SELECT council_id, department_id, status FROM workers WHERE worker_id = $1 FOR UPDATE", [workerId],
    );
    if (lockedWorker.rowCount !== 1) throw new CertificationNotFoundError(`Worker not found: ${workerId}`);
    if (lockedWorker.rows[0]!.council_id !== councilId) throw new CertificationError("Worker Council identity changed during certification");
    if (lockedWorker.rows[0]!.status !== "succeeded") throw new CertificationError("Only a worker that terminated successfully can be certified");

    const contract = await client.query<{ version: string; content_hash: string; launch_state: string }>(
      "SELECT version, content_hash, launch_state FROM task_contracts WHERE contract_id = $1 FOR SHARE", [council.contractId],
    );
    if (contract.rowCount !== 1) throw new CertificationError("Task Contract not found for certification");
    const contractRow = contract.rows[0]!;
    const snapshotContract = council.snapshot.contract;
    if (Number(contractRow.version) !== snapshotContract.version || contractRow.content_hash.trim() !== snapshotContract.contentHash) {
      throw new CertificationError("Council and worker lineage is stale after a Task Contract amendment");
    }
    if (contractRow.launch_state !== "launched") throw new CertificationError("Task Contract is not launched");

    const acceptance = await client.query<{ acceptance_id: string; commit_sha: string }>(
      "SELECT acceptance_id, commit_sha FROM department_acceptances WHERE worker_id = $1 FOR SHARE", [workerId],
    );
    if (acceptance.rowCount !== 1) throw new CertificationError("Worker output requires durable Department acceptance before certification");
    const accepted = acceptance.rows[0]!;
    const revision = await client.query<{ revision_id: string; commit_sha: string }>(
      "SELECT revision_id, commit_sha FROM goal_integration_revisions WHERE goal_id = $1 ORDER BY revision_number DESC LIMIT 1 FOR SHARE", [council.goalId],
    );
    if (revision.rowCount !== 1) throw new CertificationError("Goal has no frozen integrated revision");
    const currentRevision = revision.rows[0]!;
    if (!/^[0-9a-f]{40}$/.test(currentRevision.commit_sha.trim())) {
      throw new CertificationError("Goal integration revision is invalid");
    }
    const member = await client.query(
      `SELECT 1 FROM goal_integration_revision_commits
        WHERE revision_id = $1 AND worker_id = $2 AND commit_sha = $3`,
      [currentRevision.revision_id, workerId, accepted.commit_sha],
    );
    if (member.rowCount !== 1) throw new CertificationError("Accepted worker commit is not included in the current Goal integration revision");
    const active = await client.query(
      `SELECT 1 FROM goal_head_participations
        WHERE goal_id = $1 AND department_id = $2 AND contract_id = $3
          AND head_role_id = $4 AND status = 'active' AND active_session_ref = $5
        FOR SHARE`,
      [council.goalId, certifyingDepartmentId, council.contractId, council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === certifyingDepartmentId)?.headRoleId ?? certifyingDepartmentId, context.sessionRef],
    );
    if (active.rowCount !== 1) throw new CertificationError("Certifying Head session is no longer authorized");
    return {
      lineage: {
        goalId: council.goalId, councilId, contractId: council.contractId, contractVersion: contractRow.version,
        contractContentHash: contractRow.content_hash.trim(), integratedCommitSha: currentRevision.commit_sha.trim(), workerId,
        producingDepartment, departmentAcceptanceId: accepted.acceptance_id, integrationRevisionId: currentRevision.revision_id,
      },
      client,
      council,
    };
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    client.release();
    throw error;
  }
}

async function createCertification(
  pool: Pool,
  kind: CertificationKind,
  workerId: string,
  substance: QualityCertificationSubstance,
  certifyingDepartmentId: string,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
  content?: EvidenceContentReader,
): Promise<QualityCertification | ConditionalCertification> {
  assertValidQualityCertificationSubstance(substance);
  const prepared = await readCertificationLineage(pool, kind, workerId, certifyingDepartmentId, proof, context);
  const { lineage, client } = prepared;
  try {
    const project = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [lineage.goalId]);
    const durable = await client.query<{ evidence_id: string; sha256: string; byte_length: string }>(
      "SELECT evidence_id, sha256, byte_length FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [lineage.goalId, project.rows[0]?.project_id],
    );
    const durableIds = new Set(durable.rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));
    for (const evidenceId of substance.testEvidenceIds) if (!durableIds.has(evidenceId.trim())) throw new CertificationError(`${kind} certification test evidence is not durable: ${evidenceId}`);
    // Only ever a real defense-in-depth check when a caller supplies a real
    // content reader (e.g. the production evidence store); it never
    // fabricates trust and never weakens the existing metadata allow-list
    // check above -- it verifies each cited evidence's actual artifact
    // bytes still match its durable sha256/byteLength, catching the case
    // where a metadata row's sha256 was itself corrupted or repointed.
    if (content) {
      const rowByEvidenceId = new Map(durable.rows.map((row) => [row.evidence_id.trim(), row]));
      for (const evidenceId of substance.testEvidenceIds) {
        const row = rowByEvidenceId.get(evidenceId.trim());
        if (!row) continue; // sha256-only citation already covered by the allow-list check above
        await verifyEvidenceRecord({ sha256: row.sha256, byteLength: Number(row.byte_length) }, content);
      }
    }
    const certificationId = randomUUID();
    if (kind === "quality") {
      const inserted = await client.query<CertRow>(
        `INSERT INTO quality_certifications
          (certification_id, goal_id, contract_id, contract_version, contract_content_hash,
           integrated_commit_sha, verdict, findings, test_evidence_ids, certified_by_department,
           producing_department, worker_id, department_acceptance_id, integration_revision_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14)
         RETURNING certification_id, goal_id, contract_id, contract_version, contract_content_hash,
           integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
           verdict, certified_by_department, producing_department`,
        [certificationId, lineage.goalId, lineage.contractId, lineage.contractVersion, lineage.contractContentHash, lineage.integratedCommitSha, substance.verdict, JSON.stringify(substance.findings), JSON.stringify(substance.testEvidenceIds), certifyingDepartmentId, lineage.producingDepartment, lineage.workerId, lineage.departmentAcceptanceId, lineage.integrationRevisionId],
      );
      await client.query("COMMIT");
      return mapCert(inserted.rows[0]!);
    }
    const inserted = await client.query<ConditionalCertRow>(
      `INSERT INTO conditional_certifications
        (certification_id, kind, goal_id, contract_id, contract_version, contract_content_hash,
         integrated_commit_sha, verdict, findings, test_evidence_ids, certified_by_department,
         producing_department, worker_id, department_acceptance_id, integration_revision_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15)
       RETURNING certification_id, kind, goal_id, contract_id, contract_version, contract_content_hash,
         integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
         verdict, certified_by_department, producing_department`,
      [certificationId, kind, lineage.goalId, lineage.contractId, lineage.contractVersion, lineage.contractContentHash, lineage.integratedCommitSha, substance.verdict, JSON.stringify(substance.findings), JSON.stringify(substance.testEvidenceIds), certifyingDepartmentId, lineage.producingDepartment, lineage.workerId, lineage.departmentAcceptanceId, lineage.integrationRevisionId],
    );
    await client.query("COMMIT");
    return mapConditionalCert(inserted.rows[0]!);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof CertificationError || error instanceof CertificationNotFoundError) throw error;
    throw new CertificationError(error instanceof Error ? error.message : "Could not record certification");
  } finally {
    client.release();
  }
}

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

export interface CertificationWaiver {
  readonly waiverId: string;
  readonly certificationTable: "quality_certifications" | "conditional_certifications";
  readonly certificationId: string;
  readonly findingId: string;
  readonly authority: string;
  readonly reason: string;
}

interface WaiverRow {
  waiver_id: string; certification_table: "quality_certifications" | "conditional_certifications"; certification_id: string;
  finding_id: string; authority: string; reason: string;
}
function mapWaiver(row: WaiverRow): CertificationWaiver {
  return { waiverId: row.waiver_id, certificationTable: row.certification_table, certificationId: row.certification_id, findingId: row.finding_id, authority: row.authority, reason: row.reason };
}

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

/** Reports whether the Goal's recorded certifications currently conflict (some passed, some failed/blocked). */
export async function detectCertificationConflict(pool: Pool, goalId: string): Promise<boolean> {
  const quality = await pool.query<{ verdict: QualityVerdict }>("SELECT verdict FROM quality_certifications WHERE goal_id = $1", [goalId]);
  const conditional = await pool.query<{ verdict: QualityVerdict }>("SELECT verdict FROM conditional_certifications WHERE goal_id = $1", [goalId]);
  return certificationsConflict([...quality.rows.map((row) => row.verdict), ...conditional.rows.map((row) => row.verdict)]);
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

interface ConflictCertificationRow {
  certification_table: "quality_certifications" | "conditional_certifications";
  certification_id: string;
  verdict: QualityVerdict;
  contract_id: string;
  contract_version: string;
  contract_content_hash: string;
  integrated_commit_sha: string;
  integration_revision_id: string | null;
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
