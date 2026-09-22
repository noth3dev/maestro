import { assertValidQualityCertificationSubstance, type QualityCertificationSubstance } from "@maestro/domain";
import { verifyEvidenceRecord, type EvidenceContentReader } from "@maestro/evidence";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "../commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "../council.js";
import type { Pool, PoolClient } from "pg";
import {
  CertificationError,
  CertificationNotFoundError,
  type AcceptanceRow,
  type CertificationKind,
  type CertificationLineage,
  type CertRow,
  type ConditionalCertification,
  type ConditionalCertRow,
  type DepartmentAcceptance,
  type QualityCertification,
  type WaiverRow,
  type CertificationWaiver,
} from "./types.js";

export function mapAcceptance(row: AcceptanceRow): DepartmentAcceptance {
  return { acceptanceId: row.acceptance_id, workerId: row.worker_id, commitSha: row.commit_sha, reason: row.reason, acceptedBy: row.accepted_by };
}

export function mapCert(row: CertRow): QualityCertification {
  return {
    certificationId: row.certification_id, goalId: row.goal_id, contractId: row.contract_id, contractVersion: Number(row.contract_version),
    contractContentHash: row.contract_content_hash.trim(), integratedCommitSha: row.integrated_commit_sha.trim(),
    workerId: row.worker_id, departmentAcceptanceId: row.department_acceptance_id, integrationRevisionId: row.integration_revision_id,
    verdict: row.verdict, certifiedByDepartment: row.certified_by_department, producingDepartment: row.producing_department,
  };
}

export function mapConditionalCert(row: ConditionalCertRow): ConditionalCertification {
  return {
    certificationId: row.certification_id, kind: row.kind, goalId: row.goal_id, contractId: row.contract_id,
    contractVersion: Number(row.contract_version), contractContentHash: row.contract_content_hash.trim(), integratedCommitSha: row.integrated_commit_sha.trim(),
    workerId: row.worker_id, departmentAcceptanceId: row.department_acceptance_id, integrationRevisionId: row.integration_revision_id,
    verdict: row.verdict, certifiedByDepartment: row.certified_by_department, producingDepartment: row.producing_department,
  };
}

export function mapWaiver(row: WaiverRow): CertificationWaiver {
  return { waiverId: row.waiver_id, certificationTable: row.certification_table, certificationId: row.certification_id, findingId: row.finding_id, authority: row.authority, reason: row.reason };
}

export async function assertAuthorizedDepartmentHead(pool: Pool, councilId: string, departmentId: string, context: CouncilActorContext, councilOverride?: Awaited<ReturnType<typeof readHeadCouncil>>, client?: PoolClient): Promise<void> {
  const council = councilOverride ?? await readHeadCouncil(pool, councilId);
  const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
  if (captured === undefined) throw new CertificationError(`Department is not a captured Council participant: ${departmentId}`);
  const authorized = captured.headRoleId !== undefined
    ? isAuthorizedHeadCouncilActor(context, captured)
    : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
  if (!authorized) throw new CertificationError("Actor is not bound to the captured Head identity and session");
  const active = await (client ?? pool).query(
    "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND contract_id = $3 AND head_role_id = $4 AND status = 'active' AND active_session_ref = $5",
    [council.goalId, departmentId, council.contractId, captured.headRoleId ?? captured.participantId, captured.sessionRef],
  );
  if (active.rowCount !== 1) throw new CertificationError("Captured Head session is no longer authorized");
}

/** A valid lease alone does not authorize a certification write once a Goal is paused, stopping, stopped, or emergency-stopped -- same invariant every other Phase 2/3 write module enforces. */
export async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 33))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

export function assertValidLeaseProofFor(goalId: string, proof: GoalLeaseProof): void {
  if (goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
}

/**
 * Read and lock every identity fact needed by a certification.  In particular,
 * the accepted commit and the frozen Goal revision come from durable rows;
 * callers cannot supply a SHA or a contract version to certify.
 */
export async function readCertificationLineage(
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

export async function createCertification(
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
      const rowsByCitation = new Map<string, typeof durable.rows>();
      for (const row of durable.rows) {
        for (const citation of [row.evidence_id.trim(), row.sha256.trim()]) {
          const matches = rowsByCitation.get(citation) ?? [];
          matches.push(row);
          rowsByCitation.set(citation, matches);
        }
      }
      for (const [citation, rows] of rowsByCitation) {
        const metadata = new Set(rows.map((row) => `${row.sha256.trim()}:${row.byte_length}`));
        if (metadata.size > 1) throw new CertificationError(`Ambiguous evidence citation: ${citation}`);
      }
      for (const evidenceId of substance.testEvidenceIds) {
        const rows = rowsByCitation.get(evidenceId.trim()) ?? [];
        for (const row of rows) {
          await verifyEvidenceRecord({ sha256: row.sha256, byteLength: Number(row.byte_length) }, content);
        }
      }
    }
    const certificationId = context.commandId;
    if (kind === "quality") {
      const inserted = await client.query<CertRow>(
        `INSERT INTO quality_certifications
          (certification_id, goal_id, contract_id, contract_version, contract_content_hash,
           integrated_commit_sha, verdict, findings, test_evidence_ids, certified_by_department,
           producing_department, worker_id, department_acceptance_id, integration_revision_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14)
         ON CONFLICT (certification_id) DO NOTHING
         RETURNING certification_id, goal_id, contract_id, contract_version, contract_content_hash,
           integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
           verdict, findings, test_evidence_ids, certified_by_department, producing_department`,
        [certificationId, lineage.goalId, lineage.contractId, lineage.contractVersion, lineage.contractContentHash, lineage.integratedCommitSha, substance.verdict, JSON.stringify(substance.findings), JSON.stringify(substance.testEvidenceIds), certifyingDepartmentId, lineage.producingDepartment, lineage.workerId, lineage.departmentAcceptanceId, lineage.integrationRevisionId],
      );
      if ((inserted.rowCount ?? 0) === 0) {
        const prior = await client.query<CertRow>(
          `SELECT certification_id, goal_id, contract_id, contract_version, contract_content_hash,
             integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
             verdict, findings, test_evidence_ids, certified_by_department, producing_department
             FROM quality_certifications WHERE certification_id = $1`,
          [certificationId],
        );
        const existing = prior.rows[0];
        const same = existing !== undefined && existing.goal_id === lineage.goalId && existing.contract_id === lineage.contractId &&
          Number(existing.contract_version) === Number(lineage.contractVersion) && existing.contract_content_hash.trim() === lineage.contractContentHash &&
          existing.integrated_commit_sha.trim() === lineage.integratedCommitSha && existing.worker_id === lineage.workerId &&
          existing.department_acceptance_id === lineage.departmentAcceptanceId && existing.integration_revision_id === lineage.integrationRevisionId &&
          existing.verdict === substance.verdict && JSON.stringify(existing.findings) === JSON.stringify(substance.findings) &&
          JSON.stringify(existing.test_evidence_ids) === JSON.stringify(substance.testEvidenceIds) &&
          existing.certified_by_department === certifyingDepartmentId && existing.producing_department === lineage.producingDepartment;
        if (!same) throw new CertificationError("Certification command identity was reused with different content");
        await client.query("COMMIT");
        return mapCert(existing);
      }
      await client.query("COMMIT");
      return mapCert(inserted.rows[0]!);
    }
    const inserted = await client.query<ConditionalCertRow>(
      `INSERT INTO conditional_certifications
        (certification_id, kind, goal_id, contract_id, contract_version, contract_content_hash,
         integrated_commit_sha, verdict, findings, test_evidence_ids, certified_by_department,
         producing_department, worker_id, department_acceptance_id, integration_revision_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15)
       ON CONFLICT (certification_id) DO NOTHING
       RETURNING certification_id, kind, goal_id, contract_id, contract_version, contract_content_hash,
         integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
         verdict, findings, test_evidence_ids, certified_by_department, producing_department`,
      [certificationId, kind, lineage.goalId, lineage.contractId, lineage.contractVersion, lineage.contractContentHash, lineage.integratedCommitSha, substance.verdict, JSON.stringify(substance.findings), JSON.stringify(substance.testEvidenceIds), certifyingDepartmentId, lineage.producingDepartment, lineage.workerId, lineage.departmentAcceptanceId, lineage.integrationRevisionId],
    );
    if ((inserted.rowCount ?? 0) === 0) {
      const prior = await client.query<ConditionalCertRow>(
        `SELECT certification_id, kind, goal_id, contract_id, contract_version, contract_content_hash,
           integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
           verdict, findings, test_evidence_ids, certified_by_department, producing_department
           FROM conditional_certifications WHERE certification_id = $1`,
        [certificationId],
      );
      const existing = prior.rows[0];
      const same = existing !== undefined && existing.kind === kind && existing.goal_id === lineage.goalId && existing.contract_id === lineage.contractId &&
        Number(existing.contract_version) === Number(lineage.contractVersion) && existing.contract_content_hash.trim() === lineage.contractContentHash &&
        existing.integrated_commit_sha.trim() === lineage.integratedCommitSha && existing.worker_id === lineage.workerId &&
        existing.department_acceptance_id === lineage.departmentAcceptanceId && existing.integration_revision_id === lineage.integrationRevisionId &&
        existing.verdict === substance.verdict && JSON.stringify(existing.findings) === JSON.stringify(substance.findings) &&
        JSON.stringify(existing.test_evidence_ids) === JSON.stringify(substance.testEvidenceIds) &&
        existing.certified_by_department === certifyingDepartmentId && existing.producing_department === lineage.producingDepartment;
      if (!same) throw new CertificationError("Certification command identity was reused with different content");
      await client.query("COMMIT");
      return mapConditionalCert(existing);
    }
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
