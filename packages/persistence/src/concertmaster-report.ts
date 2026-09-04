import { randomUUID } from "node:crypto";
import { certificationsConflict, evaluateCertificationCompleteness, requiredConditionalCertifications, taskContractContentHash, type CertificationRecordFact } from "@maestro/domain";
import type { EvidenceContentReader } from "@maestro/evidence";
import type { Pool } from "pg";
import { isCertificationConflictResolved } from "./certification.js";
import { recordEvidenceBundle } from "./evidence-bundle.js";

export class ConcertmasterReportError extends Error {}

export interface ConcertmasterFinalReport {
  readonly reportId: string;
  readonly goalId: string;
  readonly success: boolean;
  readonly blockers: readonly { readonly reason: string; readonly detail: string }[];
  readonly ceoRequest: string;
  readonly whatChanged: string;
  readonly userVisibleBehaviorPassed: boolean;
  readonly participatingDepartments: readonly string[];
  readonly keyDecisions: readonly string[];
  readonly dissent: readonly string[];
  readonly independentValidation: readonly string[];
  readonly costCents: number;
  readonly budgetCents: number;
  readonly incidents: readonly string[];
  readonly knownLimitations: readonly string[];
  readonly criticalActionAwaitingApproval: boolean;
  readonly evidenceBundleId: string;
}

/**
 * Generates Concertmaster's final report. Success is determined only by durable worker
 * outcomes/acceptances, a frozen Goal integration revision, and current
 * certification rows. Plan completion percentage and worker self-report are
 * never used as substitutes for those facts.
 */
export async function generateConcertmasterFinalReport(pool: Pool, goalId: string, content?: EvidenceContentReader): Promise<ConcertmasterFinalReport> {
  const councilRow = await pool.query<{
    council_id: string; contract_id: string; decision_packet: Record<string, unknown> | null;
    snapshot_payload: Record<string, unknown>; snapshot_hash: string;
  }>(
    `SELECT council_id, contract_id, decision_packet, snapshot_payload, snapshot_hash
       FROM head_councils WHERE goal_id = $1 AND state = 'resolved'
       ORDER BY created_at DESC, council_id DESC LIMIT 1`, [goalId],
  );
  if (councilRow.rowCount !== 1) throw new ConcertmasterReportError("No resolved Council decision found for this Goal");
  const council = councilRow.rows[0]!;
  const contractRow = await pool.query<{
    content: Record<string, unknown>; version: string; contract_id: string; content_hash: string; launch_state: string;
  }>(
    "SELECT contract_id, content, version, content_hash, launch_state FROM task_contracts WHERE contract_id = $1", [council.contract_id],
  );
  if (contractRow.rowCount !== 1) throw new ConcertmasterReportError("Task Contract not found for this Goal");
  const contract = contractRow.rows[0]!;
  const contractContent = contract.content as {
    desiredOutcome: string; criticalActionExpectations: readonly string[]; externalServiceAssumptions: readonly string[]; project: { dataBoundary: string };
  };
  const packet = council.decision_packet as { departmentOwnership?: readonly { departmentId: string }[]; dissent?: readonly string[]; selectedDirection?: string; criticalActions?: readonly string[] } | null;
  const participatingDepartments = (packet?.departmentOwnership ?? []).map((ownership) => ownership.departmentId);

  const requiredKinds = ["quality" as const, ...requiredConditionalCertifications({
    criticalActionExpectations: contractContent.criticalActionExpectations,
    criticalActions: packet?.criticalActions ?? [],
    externalServiceAssumptions: contractContent.externalServiceAssumptions,
    dataBoundary: contractContent.project.dataBoundary,
  })];

  const branch = await pool.query<{ repository_path: string; branch_name: string; base_revision: string }>(
    "SELECT repository_path, branch_name, base_revision FROM goal_integration_branches WHERE goal_id = $1", [goalId],
  );
  const revision = await pool.query<{
    revision_id: string; commit_sha: string; repository_path: string; branch_name: string; base_revision: string;
  }>(
    `SELECT revision_id, commit_sha, repository_path, branch_name, base_revision
       FROM goal_integration_revisions WHERE goal_id = $1 ORDER BY revision_number DESC LIMIT 1`, [goalId],
  );
  const frozenRevision = revision.rowCount === 1 && branch.rowCount === 1
    && revision.rows[0]!.repository_path === branch.rows[0]!.repository_path
    && revision.rows[0]!.branch_name === branch.rows[0]!.branch_name
    && revision.rows[0]!.base_revision === branch.rows[0]!.base_revision
    && revision.rows[0]!.commit_sha.trim() !== branch.rows[0]!.base_revision.trim()
    && /^[0-9a-f]{40}$/.test(revision.rows[0]!.commit_sha.trim());
  const currentRevision = revision.rowCount === 1 && frozenRevision ? revision.rows[0]! : null;

  const workers = await pool.query<{
    worker_id: string; status: string; acceptance_id: string | null; accepted_commit_sha: string | null; included: boolean;
  }>(
    `SELECT worker.worker_id, worker.status, acceptance.acceptance_id,
            acceptance.commit_sha AS accepted_commit_sha,
            CASE WHEN acceptance.acceptance_id IS NULL OR $2::uuid IS NULL THEN false
                 ELSE EXISTS (SELECT 1 FROM goal_integration_revision_commits member
                               WHERE member.revision_id = $2 AND member.worker_id = worker.worker_id
                                 AND member.commit_sha = acceptance.commit_sha)
            END AS included
       FROM workers worker
       JOIN department_plans plan
         ON plan.council_id = worker.council_id AND plan.department_id = worker.department_id
        AND plan.goal_id = $1
       LEFT JOIN department_acceptances acceptance ON acceptance.worker_id = worker.worker_id
      ORDER BY worker.department_id, worker.item_id, worker.attempt, worker.worker_id`, [goalId, currentRevision?.revision_id ?? null],
  );

  interface StoredCertification {
    certification_id: string; kind: "quality" | "security" | "safety_compliance";
    verdict: "passed" | "failed" | "blocked"; contract_id: string; contract_version: string;
    contract_content_hash: string; integrated_commit_sha: string; findings: { severity: string; findingId: string }[];
    integration_revision_id: string | null; created_at: Date | string;
  }
  const certificationRows = (await pool.query<StoredCertification>(
    `SELECT certification_id, 'quality'::text AS kind, verdict, contract_id, contract_version,
            contract_content_hash, integrated_commit_sha, findings, integration_revision_id, created_at
       FROM quality_certifications WHERE goal_id = $1
     UNION ALL
     SELECT certification_id, kind, verdict, contract_id, contract_version,
            contract_content_hash, integrated_commit_sha, findings, integration_revision_id, created_at
       FROM conditional_certifications WHERE goal_id = $1`, [goalId],
  )).rows;
  const expectedRevisionId = currentRevision?.revision_id;
  const expectedCommitSha = currentRevision?.commit_sha.trim();
  const expectedHash = contract.content_hash.trim();
  const currentCertifications = certificationRows.filter((row) =>
    row.contract_id === council.contract_id
      && Number(row.contract_version) === Number(contract.version)
      && row.contract_content_hash.trim() === expectedHash
      && expectedRevisionId !== undefined && row.integration_revision_id === expectedRevisionId
      && expectedCommitSha !== undefined && row.integrated_commit_sha.trim() === expectedCommitSha,
  );
  const latestByKind = new Map<string, StoredCertification>();
  for (const row of [...currentCertifications].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)) || right.certification_id.localeCompare(left.certification_id))) {
    if (!latestByKind.has(row.kind)) latestByKind.set(row.kind, row);
  }

  async function hasUnwaivedCritical(table: "quality_certifications" | "conditional_certifications", certificationId: string, findings: readonly { severity: string; findingId: string }[]): Promise<boolean> {
    const critical = findings.filter((finding) => finding.severity === "critical");
    if (critical.length === 0) return false;
    const waivers = await pool.query<{ finding_id: string }>(
      "SELECT finding_id FROM certification_waivers WHERE certification_table = $1 AND certification_id = $2 AND expires_at > transaction_timestamp()", [table, certificationId],
    );
    const waivedIds = new Set(waivers.rows.map((row) => row.finding_id));
    return critical.some((finding) => !waivedIds.has(finding.findingId));
  }

  const records: CertificationRecordFact[] = [];
  for (const row of latestByKind.values()) {
    records.push({
      kind: row.kind, verdict: row.verdict, contractId: row.contract_id, contractVersion: Number(row.contract_version),
      contractContentHash: row.contract_content_hash.trim(), integratedCommitSha: row.integrated_commit_sha.trim(),
      integrationRevisionId: row.integration_revision_id, certificationId: row.certification_id,
      hasUnwaivedCriticalFinding: await hasUnwaivedCritical(row.kind === "quality" ? "quality_certifications" : "conditional_certifications", row.certification_id, row.findings),
    });
  }

  const openChallenges = await pool.query<{ count: string }>("SELECT count(*)::int AS count FROM metronome_challenges WHERE goal_id = $1 AND status <> 'resolved'", [goalId]);
  const conflictVerdicts = currentCertifications.map((row) => row.verdict);
  const conflict = certificationsConflict(conflictVerdicts);
  const conflictResolved = conflict
    ? await isCertificationConflictResolved(pool, goalId, currentCertifications.map((row) => row.certification_id), {
      contractId: council.contract_id, contractVersion: Number(contract.version), contractContentHash: expectedHash,
      revisionId: expectedRevisionId ?? "", commitSha: expectedCommitSha ?? "",
    })
    : true;

  const lineageBlockers: { reason: string; detail: string }[] = [];
  const snapshotContract = (council.snapshot_payload?.contract ?? {}) as { contractId?: string; version?: number; contentHash?: string };
  let contractHashValid = true;
  try {
    contractHashValid = taskContractContentHash(contractContent as never) === expectedHash;
  } catch {
    contractHashValid = false;
  }
  if (snapshotContract.contractId !== council.contract_id || Number(snapshotContract.version) !== Number(contract.version) || snapshotContract.contentHash !== expectedHash || !contractHashValid || contract.launch_state !== "launched") {
    lineageBlockers.push({ reason: "certification_identity_mismatch", detail: "Resolved Council is not bound to the current launched Task Contract identity" });
  }
  const evaluated = evaluateCertificationCompleteness({
    requiredKinds, records, openChallengeCount: Number(openChallenges.rows[0]!.count),
    expectedContractId: council.contract_id, expectedContractVersion: Number(contract.version), expectedContractContentHash: expectedHash,
    expectedIntegrationRevisionId: expectedRevisionId ?? "", expectedIntegratedCommitSha: expectedCommitSha ?? "",
    hasFrozenIntegratedRevision: frozenRevision,
    workers: workers.rows.map((worker) => ({ workerId: worker.worker_id, status: worker.status, hasDepartmentAcceptance: worker.acceptance_id !== null, acceptanceBoundToIntegratedRevision: worker.included })),
    unresolvedCertificationConflict: conflict && !conflictResolved,
  });
  const blockers = [...lineageBlockers, ...evaluated];
  const success = blockers.length === 0;

  const commits = await pool.query<{ commit_sha: string; message: string }>(
    `SELECT ic.commit_sha, ic.message FROM integration_commits ic
       JOIN workers w ON w.worker_id = ic.worker_id
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        AND dp.goal_id = $1 ORDER BY ic.recorded_at, ic.commit_id`, [goalId],
  );
  const whatChanged = currentRevision === null
    ? (commits.rows.length === 0 ? "No frozen integrated revision recorded" : `No frozen integrated revision recorded; worker commits: ${commits.rows.map((row) => `${row.commit_sha.trim().slice(0, 12)}: ${row.message}`).join("; ")}`)
    : `${currentRevision.commit_sha.trim().slice(0, 12)}: ${commits.rows.map((row) => row.message).join("; ") || "integrated revision frozen"}`;

  const goalReservation = await pool.query<{ amount_cents: string }>("SELECT amount_cents FROM budget_reservations WHERE goal_id = $1 AND scope = 'goal' ORDER BY created_at DESC LIMIT 1", [goalId]);
  const departmentSpend = await pool.query<{ total: string }>("SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM budget_reservations WHERE goal_id = $1 AND scope = 'department'", [goalId]);

  const findings = await pool.query<{ rule_id: string; evidence_identity: string; resolved_at: Date | null }>("SELECT rule_id, evidence_identity, resolved_at FROM metronome_findings WHERE goal_id = $1", [goalId]);
  const incidents = findings.rows.map((row) => `${row.rule_id}: ${row.evidence_identity}`);
  const unresolvedLimitations = findings.rows.filter((row) => row.resolved_at === null).map((row) => `unresolved: ${row.rule_id} (${row.evidence_identity})`);
  const waiverRows = await pool.query<{ reason: string; follow_up: string }>(
    `SELECT reason, follow_up FROM certification_waivers
      WHERE (certification_table = 'quality_certifications' AND certification_id IN (SELECT certification_id FROM quality_certifications WHERE goal_id = $1))
         OR (certification_table = 'conditional_certifications' AND certification_id IN (SELECT certification_id FROM conditional_certifications WHERE goal_id = $1))`, [goalId],
  );
  const knownLimitations = [...unresolvedLimitations, ...waiverRows.rows.map((row) => `waived: ${row.reason} (follow-up: ${row.follow_up})`)]
    .concat(conflict && !conflictResolved ? ["unresolved: conflicting certifications"] : []);
  const criticalActionAwaitingApproval = records.some((record) => record.hasUnwaivedCriticalFinding);

  const { bundleId } = await recordEvidenceBundle(pool, goalId, content);
  const reportId = randomUUID();
  await pool.query(
    `INSERT INTO concertmaster_final_reports (report_id, goal_id, success, blockers, ceo_request, what_changed, user_visible_behavior_passed, participating_departments, key_decisions, dissent, independent_validation, cost_cents, budget_cents, incidents, known_limitations, critical_action_awaiting_approval, evidence_bundle_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15::jsonb, $16, $17)`,
    [
      reportId, goalId, success, JSON.stringify(blockers), contractContent.desiredOutcome, whatChanged,
      latestByKind.get("quality")?.verdict === "passed", JSON.stringify(participatingDepartments),
      JSON.stringify(packet?.selectedDirection !== undefined ? [packet.selectedDirection] : []), JSON.stringify(packet?.dissent ?? []),
      JSON.stringify(records.map((record) => `${record.kind}: ${record.verdict}`)),
      Number(departmentSpend.rows[0]!.total), Number(goalReservation.rows[0]?.amount_cents ?? 0),
      JSON.stringify(incidents), JSON.stringify(knownLimitations), criticalActionAwaitingApproval, bundleId,
    ],
  );

  return {
    reportId, goalId, success, blockers, ceoRequest: contractContent.desiredOutcome, whatChanged,
    userVisibleBehaviorPassed: latestByKind.get("quality")?.verdict === "passed", participatingDepartments,
    keyDecisions: packet?.selectedDirection !== undefined ? [packet.selectedDirection] : [], dissent: packet?.dissent ?? [],
    independentValidation: records.map((record) => `${record.kind}: ${record.verdict}`),
    costCents: Number(departmentSpend.rows[0]!.total), budgetCents: Number(goalReservation.rows[0]?.amount_cents ?? 0),
    incidents, knownLimitations, criticalActionAwaitingApproval, evidenceBundleId: bundleId,
  };
}

export async function readConcertmasterFinalReport(pool: Pool, reportId: string): Promise<ConcertmasterFinalReport> {
  const result = await pool.query<{
    report_id: string; goal_id: string; success: boolean; blockers: { reason: string; detail: string }[]; ceo_request: string; what_changed: string;
    user_visible_behavior_passed: boolean; participating_departments: string[]; key_decisions: string[]; dissent: string[]; independent_validation: string[];
    cost_cents: string; budget_cents: string; incidents: string[]; known_limitations: string[]; critical_action_awaiting_approval: boolean; evidence_bundle_id: string;
  }>("SELECT * FROM concertmaster_final_reports WHERE report_id = $1", [reportId]);
  if (result.rowCount !== 1) throw new ConcertmasterReportError(`Concertmaster final report not found: ${reportId}`);
  const row = result.rows[0]!;
  return {
    reportId: row.report_id, goalId: row.goal_id, success: row.success, blockers: row.blockers, ceoRequest: row.ceo_request, whatChanged: row.what_changed,
    userVisibleBehaviorPassed: row.user_visible_behavior_passed, participatingDepartments: row.participating_departments, keyDecisions: row.key_decisions,
    dissent: row.dissent, independentValidation: row.independent_validation, costCents: Number(row.cost_cents), budgetCents: Number(row.budget_cents),
    incidents: row.incidents, knownLimitations: row.known_limitations, criticalActionAwaitingApproval: row.critical_action_awaiting_approval, evidenceBundleId: row.evidence_bundle_id,
  };
}
