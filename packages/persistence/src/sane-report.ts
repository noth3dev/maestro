import { randomUUID } from "node:crypto";
import { evaluateCertificationCompleteness, requiredConditionalCertifications, type CertificationRecordFact } from "@maestro/domain";
import type { Pool } from "pg";
import { recordEvidenceBundle } from "./evidence-bundle.js";

export class SaneReportError extends Error {}

export interface SaneFinalReport {
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
 * Generates Sane's final report. Success is determined ONLY by
 * `evaluateCertificationCompleteness` against real certification records
 * and open challenges -- this function never reads or considers a plan-item
 * completion count or any worker-reported status, matching "Do not report
 * success from completion percentage or worker self-report."
 */
export async function generateSaneFinalReport(pool: Pool, goalId: string): Promise<SaneFinalReport> {
  const councilRow = await pool.query<{ council_id: string; contract_id: string; decision_packet: Record<string, unknown> | null }>(
    "SELECT council_id, contract_id, decision_packet FROM head_councils WHERE goal_id = $1 AND state = 'resolved' ORDER BY created_at DESC LIMIT 1",
    [goalId],
  );
  if (councilRow.rowCount !== 1) throw new SaneReportError("No resolved Council decision found for this Goal");
  const { contract_id: contractId, decision_packet: decisionPacket } = councilRow.rows[0]!;
  const contractRow = await pool.query<{ content: Record<string, unknown>; version: string }>("SELECT content, version FROM task_contracts WHERE contract_id = $1", [contractId]);
  if (contractRow.rowCount !== 1) throw new SaneReportError("Task Contract not found for this Goal");
  const contractContent = contractRow.rows[0]!.content as {
    desiredOutcome: string; criticalActionExpectations: readonly string[]; externalServiceAssumptions: readonly string[]; project: { dataBoundary: string };
  };
  const packet = decisionPacket as { departmentOwnership?: readonly { departmentId: string }[]; dissent?: readonly string[]; selectedDirection?: string; criticalActions?: readonly string[] } | null;
  const participatingDepartments = (packet?.departmentOwnership ?? []).map((ownership) => ownership.departmentId);

  const requiredKinds = ["quality" as const, ...requiredConditionalCertifications({
    criticalActionExpectations: contractContent.criticalActionExpectations,
    criticalActions: packet?.criticalActions ?? [],
    externalServiceAssumptions: contractContent.externalServiceAssumptions,
    dataBoundary: contractContent.project.dataBoundary,
  })];

  const quality = await pool.query<{ verdict: "passed" | "failed" | "blocked"; contract_id: string; contract_version: string; integrated_commit_sha: string; findings: { severity: string; findingId: string }[]; certification_id: string }>(
    "SELECT verdict, contract_id, contract_version, integrated_commit_sha, findings, certification_id FROM quality_certifications WHERE goal_id = $1 ORDER BY created_at DESC LIMIT 1",
    [goalId],
  );
  const conditional = await pool.query<{ kind: "security" | "safety_compliance"; verdict: "passed" | "failed" | "blocked"; contract_id: string; contract_version: string; integrated_commit_sha: string; findings: { severity: string; findingId: string }[]; certification_id: string }>(
    "SELECT DISTINCT ON (kind) kind, verdict, contract_id, contract_version, integrated_commit_sha, findings, certification_id FROM conditional_certifications WHERE goal_id = $1 ORDER BY kind, created_at DESC",
    [goalId],
  );

  async function hasUnwaivedCritical(table: "quality_certifications" | "conditional_certifications", certificationId: string, findings: readonly { severity: string; findingId: string }[]): Promise<boolean> {
    const critical = findings.filter((finding) => finding.severity === "critical");
    if (critical.length === 0) return false;
    const waivers = await pool.query<{ finding_id: string }>("SELECT finding_id FROM certification_waivers WHERE certification_table = $1 AND certification_id = $2 AND expires_at > transaction_timestamp()", [table, certificationId]);
    const waivedIds = new Set(waivers.rows.map((row) => row.finding_id));
    return critical.some((finding) => !waivedIds.has(finding.findingId));
  }

  const records: CertificationRecordFact[] = [];
  if (quality.rowCount === 1) {
    const row = quality.rows[0]!;
    records.push({ kind: "quality", verdict: row.verdict, contractId: row.contract_id, contractVersion: Number(row.contract_version), integratedCommitSha: row.integrated_commit_sha, hasUnwaivedCriticalFinding: await hasUnwaivedCritical("quality_certifications", row.certification_id, row.findings) });
  }
  for (const row of conditional.rows) {
    records.push({ kind: row.kind, verdict: row.verdict, contractId: row.contract_id, contractVersion: Number(row.contract_version), integratedCommitSha: row.integrated_commit_sha, hasUnwaivedCriticalFinding: await hasUnwaivedCritical("conditional_certifications", row.certification_id, row.findings) });
  }

  const openChallenges = await pool.query<{ count: string }>("SELECT count(*)::int AS count FROM sentinel_challenges WHERE goal_id = $1 AND status <> 'resolved'", [goalId]);
  const blockers = evaluateCertificationCompleteness({ requiredKinds, records, openChallengeCount: Number(openChallenges.rows[0]!.count) });
  const success = blockers.length === 0;

  const commits = await pool.query<{ commit_sha: string; message: string }>(
    `SELECT ic.commit_sha, ic.message FROM integration_commits ic
       JOIN workers w ON w.worker_id = ic.worker_id
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
      WHERE dp.goal_id = $1 ORDER BY ic.recorded_at`,
    [goalId],
  );
  const whatChanged = commits.rows.length === 0 ? "No integrated commits recorded" : commits.rows.map((row) => `${row.commit_sha.slice(0, 12)}: ${row.message}`).join("; ");

  const goalReservation = await pool.query<{ amount_cents: string }>("SELECT amount_cents FROM budget_reservations WHERE goal_id = $1 AND scope = 'goal' ORDER BY created_at DESC LIMIT 1", [goalId]);
  const departmentSpend = await pool.query<{ total: string }>("SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM budget_reservations WHERE goal_id = $1 AND scope = 'department'", [goalId]);

  const findings = await pool.query<{ rule_id: string; evidence_identity: string; resolved_at: Date | null }>("SELECT rule_id, evidence_identity, resolved_at FROM sentinel_findings WHERE goal_id = $1", [goalId]);
  const incidents = findings.rows.map((row) => `${row.rule_id}: ${row.evidence_identity}`);
  const unresolvedLimitations = findings.rows.filter((row) => row.resolved_at === null).map((row) => `unresolved: ${row.rule_id} (${row.evidence_identity})`);
  const waiverRows = await pool.query<{ reason: string; follow_up: string }>(
    `SELECT reason, follow_up FROM certification_waivers
      WHERE (certification_table = 'quality_certifications' AND certification_id IN (SELECT certification_id FROM quality_certifications WHERE goal_id = $1))
         OR (certification_table = 'conditional_certifications' AND certification_id IN (SELECT certification_id FROM conditional_certifications WHERE goal_id = $1))`,
    [goalId],
  );
  const knownLimitations = [...unresolvedLimitations, ...waiverRows.rows.map((row) => `waived: ${row.reason} (follow-up: ${row.follow_up})`)];
  const criticalActionAwaitingApproval = records.some((record) => record.hasUnwaivedCriticalFinding);

  const { bundleId } = await recordEvidenceBundle(pool, goalId);

  const reportId = randomUUID();
  await pool.query(
    `INSERT INTO sane_final_reports (report_id, goal_id, success, blockers, ceo_request, what_changed, user_visible_behavior_passed, participating_departments, key_decisions, dissent, independent_validation, cost_cents, budget_cents, incidents, known_limitations, critical_action_awaiting_approval, evidence_bundle_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15::jsonb, $16, $17)`,
    [
      reportId, goalId, success, JSON.stringify(blockers), contractContent.desiredOutcome, whatChanged,
      quality.rowCount === 1 && quality.rows[0]!.verdict === "passed", JSON.stringify(participatingDepartments),
      JSON.stringify(packet?.selectedDirection !== undefined ? [packet.selectedDirection] : []), JSON.stringify(packet?.dissent ?? []),
      JSON.stringify(records.map((record) => `${record.kind}: ${record.verdict}`)),
      Number(departmentSpend.rows[0]!.total), Number(goalReservation.rows[0]?.amount_cents ?? 0),
      JSON.stringify(incidents), JSON.stringify(knownLimitations), criticalActionAwaitingApproval, bundleId,
    ],
  );

  return {
    reportId, goalId, success, blockers, ceoRequest: contractContent.desiredOutcome, whatChanged,
    userVisibleBehaviorPassed: quality.rowCount === 1 && quality.rows[0]!.verdict === "passed",
    participatingDepartments, keyDecisions: packet?.selectedDirection !== undefined ? [packet.selectedDirection] : [], dissent: packet?.dissent ?? [],
    independentValidation: records.map((record) => `${record.kind}: ${record.verdict}`),
    costCents: Number(departmentSpend.rows[0]!.total), budgetCents: Number(goalReservation.rows[0]?.amount_cents ?? 0),
    incidents, knownLimitations, criticalActionAwaitingApproval, evidenceBundleId: bundleId,
  };
}

export async function readSaneFinalReport(pool: Pool, reportId: string): Promise<SaneFinalReport> {
  const result = await pool.query<{
    report_id: string; goal_id: string; success: boolean; blockers: { reason: string; detail: string }[]; ceo_request: string; what_changed: string;
    user_visible_behavior_passed: boolean; participating_departments: string[]; key_decisions: string[]; dissent: string[]; independent_validation: string[];
    cost_cents: string; budget_cents: string; incidents: string[]; known_limitations: string[]; critical_action_awaiting_approval: boolean; evidence_bundle_id: string;
  }>("SELECT * FROM sane_final_reports WHERE report_id = $1", [reportId]);
  if (result.rowCount !== 1) throw new SaneReportError(`Sane final report not found: ${reportId}`);
  const row = result.rows[0]!;
  return {
    reportId: row.report_id, goalId: row.goal_id, success: row.success, blockers: row.blockers, ceoRequest: row.ceo_request, whatChanged: row.what_changed,
    userVisibleBehaviorPassed: row.user_visible_behavior_passed, participatingDepartments: row.participating_departments, keyDecisions: row.key_decisions,
    dissent: row.dissent, independentValidation: row.independent_validation, costCents: Number(row.cost_cents), budgetCents: Number(row.budget_cents),
    incidents: row.incidents, knownLimitations: row.known_limitations, criticalActionAwaitingApproval: row.critical_action_awaiting_approval, evidenceBundleId: row.evidence_bundle_id,
  };
}
