import { randomUUID } from "node:crypto";
import { MODEL_CAPABILITY_AXES, assertValidRoutingEvidence, canonicalJson, assertValidTaskContractSubstance, certificationsConflict, evaluateCertificationCompleteness, requiredConditionalCertifications, taskContractContentHash, type CertificationRecordFact, type RoutingEvidence } from "@maestro/domain";
import type { EvidenceContentReader } from "@maestro/evidence";
import type { Pool, PoolClient } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";
import { isCertificationConflictResolved } from "./certification.js";
import { recordEvidenceBundleInTransaction } from "./evidence-bundle.js";

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

interface StoredConcertmasterFinalReport {
  report_id: string; goal_id: string; success: boolean; blockers: { reason: string; detail: string }[]; ceo_request: string; what_changed: string;
  user_visible_behavior_passed: boolean; participating_departments: string[]; key_decisions: string[]; dissent: string[]; independent_validation: string[];
  cost_cents: string; budget_cents: string; incidents: string[]; known_limitations: string[]; critical_action_awaiting_approval: boolean; evidence_bundle_id: string;
}

function mapConcertmasterFinalReport(row: StoredConcertmasterFinalReport): ConcertmasterFinalReport {
  return {
    reportId: row.report_id, goalId: row.goal_id, success: row.success, blockers: row.blockers, ceoRequest: row.ceo_request, whatChanged: row.what_changed,
    userVisibleBehaviorPassed: row.user_visible_behavior_passed, participatingDepartments: row.participating_departments, keyDecisions: row.key_decisions,
    dissent: row.dissent, independentValidation: row.independent_validation, costCents: Number(row.cost_cents), budgetCents: Number(row.budget_cents),
    incidents: row.incidents, knownLimitations: row.known_limitations, criticalActionAwaitingApproval: row.critical_action_awaiting_approval, evidenceBundleId: row.evidence_bundle_id,
  };
}

function repetitionScopeText(row: { scope_kind: string | null; remaining_count: string | null; remaining_budget_cents: string | null; repetition_expires_at: Date | string | null }): string {
  if (row.scope_kind === "bounded_count") return `bounded_count(${row.remaining_count ?? "unknown"} remaining)`;
  if (row.scope_kind === "bounded_budget") return `bounded_budget(${row.remaining_budget_cents ?? "unknown"} cents remaining)`;
  if (row.scope_kind === "bounded_time") return `bounded_time(until ${String(row.repetition_expires_at)})`;
  return row.scope_kind ?? "unknown";
}

export function renderRoutingApprovalDecision(approval: RoutingCapabilityApproval, journal: readonly { event: string; details: Record<string, unknown> }[]): string {
  const approvalEvent = journal.find((entry) => entry.event === "approval");
  const reason = approval.reason ?? (typeof approvalEvent?.details.reason === "string" ? approvalEvent.details.reason : "not recorded");
  const consequence = approval.consequence ?? (typeof approvalEvent?.details.consequence === "string" ? approvalEvent.details.consequence : "not recorded");
  return `routing approval: actor=${approval.approver_id}; tier=${approval.tier}; scope=${repetitionScopeText(approval)}; reason=${reason}; consequence=${consequence}`;
}

export interface RoutingReportSections {
  readonly approvalDecisions: readonly string[];
  readonly dissent: readonly string[];
  readonly interruptionIncidents: readonly string[];
  readonly knownLimitations: readonly string[];
}
export function renderRoutingReportSections(input: {
  readonly routingEvidence: readonly RoutingEvidence[];
  readonly approvals: ReadonlyMap<string, RoutingCapabilityApproval>;
  readonly journalByApproval: ReadonlyMap<string, readonly { event: string; details: Record<string, unknown> }[]>;
  readonly journal: readonly { event: string; details: Record<string, unknown> }[];
  readonly packetDissent: readonly string[];
  readonly limitations: readonly string[];
}): RoutingReportSections {
  const approvalDecisions = input.routingEvidence.map((route) => {
    const approval = route.approvalRef === null ? undefined : input.approvals.get(route.approvalRef);
    return approval === undefined
      ? `routing approval: none; model=${route.selectedModelRef}; pressure=${route.pressureBand}`
      : renderRoutingApprovalDecision(approval, input.journalByApproval.get(approval.approval_id) ?? []);
  });
  const interruptionIncidents = input.journal.filter((entry) => entry.event === "interruption").map((entry) => `interruption: ${JSON.stringify(entry.details)}`);
  const dissent = [...input.packetDissent, ...input.journal.filter((entry) => entry.event === "safer_alternative" && typeof entry.details.dissent === "string").map((entry) => String(entry.details.dissent))];
  return { approvalDecisions, dissent, interruptionIncidents, knownLimitations: [...input.limitations, ...interruptionIncidents] };
}

export interface RoutingEvidenceCertificationRow {
  readonly evidence_id: string; readonly goal_ref: string; readonly project_ref: string; readonly route_ref: string; readonly mode: string;
  readonly selected_model_ref: string; readonly account_binding: string; readonly candidate_refs: unknown; readonly rejections: unknown;
  readonly task_demand_hash: string; readonly pressure: number; readonly pressure_band: string; readonly decision_layer: string;
  readonly overlay_version: number | null; readonly admission_binding_ref: string; readonly rationale: string; readonly evidence: Record<string, unknown>;
}
export interface RoutingNativeBinding {
  readonly binding_id: string; readonly execution_ref: string; readonly invocation_ref: string; readonly goal_id: string; readonly project_id: string;
  readonly selected_model_provider: string; readonly selected_model_id: string; readonly actual_model_provider: string; readonly actual_model_id: string;
  readonly account_ref: string | null; readonly created_at: Date | string;
}
export interface RoutingCapabilityApproval {
  readonly approval_id: string; readonly goal_id: string; readonly project_id: string; readonly tier: string; readonly approver_id: string;
  readonly decision: string; readonly created_at: Date | string; readonly expires_at: Date | string; readonly revoked_at: Date | string | null;
  readonly policy_version: number; readonly capability_kind: string; readonly command_id: string; readonly action: string; readonly target: string; readonly reason: string | null; readonly consequence: string | null;
  readonly scope_kind: string | null; readonly remaining_count: string | null;
  readonly remaining_budget_cents: string | null; readonly repetition_expires_at: Date | string | null;
}
export interface RoutingCapabilityClaim {
  readonly claim_id: string; readonly approval_id: string; readonly capability_kind: string; readonly project_id: string; readonly goal_id: string;
  readonly command_id: string; readonly action: string; readonly target: string; readonly policy_version: number; readonly consumed_at: Date | string;
}
export function evaluateRoutingEvidenceLineage(input: {
  readonly goalId: string; readonly projectId: string; readonly routingRows: readonly RoutingEvidenceCertificationRow[];
  readonly nativeBindings: readonly RoutingNativeBinding[]; readonly approvals: readonly RoutingCapabilityApproval[]; readonly claims: readonly RoutingCapabilityClaim[];
}): { readonly validRoutingEvidence: readonly RoutingEvidence[]; readonly blockers: readonly { reason: string; detail: string }[] } {
  const blockers: { reason: string; detail: string }[] = [];
  const validRoutingEvidence: RoutingEvidence[] = [];
  for (const route of input.routingRows) {
    try { assertValidRoutingEvidence(route.evidence); } catch { blockers.push({ reason: "routing_evidence_malformed", detail: `Routing evidence ${route.evidence_id} is malformed` }); continue; }
    const evidence = route.evidence as unknown as RoutingEvidence;
    const expectedPayload = { ...evidence, evidenceId: route.evidence_id, goalRef: route.goal_ref, projectRef: route.project_ref, routeRef: route.route_ref, mode: route.mode, selectedModelRef: route.selected_model_ref, accountBinding: route.account_binding, candidateRefs: route.candidate_refs, rejections: route.rejections, taskDemandHash: route.task_demand_hash, pressure: route.pressure, pressureBand: route.pressure_band, decisionLayer: route.decision_layer, overlayVersion: route.overlay_version, admissionBindingRef: route.admission_binding_ref, rationale: route.rationale };
    if (evidence.goalRef !== input.goalId || evidence.projectRef !== input.projectId || canonicalJson(evidence) !== canonicalJson(expectedPayload)) {
      blockers.push({ reason: "routing_evidence_identity_mismatch", detail: `Routing evidence ${route.evidence_id} is outside this Goal/project scope or has altered payload` }); continue;
    }
    validRoutingEvidence.push(evidence);
  }
  if (input.routingRows.length === 0) blockers.push({ reason: "routing_evidence_missing", detail: "No durable routing evidence is recorded for this Goal" });
  const bindingsByRef = new Map<string, RoutingNativeBinding>();
  for (const binding of input.nativeBindings) { bindingsByRef.set(binding.binding_id, binding); bindingsByRef.set(binding.execution_ref, binding); bindingsByRef.set(binding.invocation_ref, binding); }
  const approvalById = new Map(input.approvals.map((approval) => [approval.approval_id, approval] as const));
  for (const route of validRoutingEvidence) {
    const binding = bindingsByRef.get(route.admissionBindingRef);
    if (!binding) { blockers.push({ reason: "routing_evidence_binding_missing", detail: `Routing evidence ${route.evidenceId} has no matching native admission binding` }); continue; }
    const selected = `${binding.selected_model_provider}/${binding.selected_model_id}`;
    const actual = `${binding.actual_model_provider}/${binding.actual_model_id}`;
    if (binding.goal_id !== input.goalId || binding.project_id !== input.projectId || binding.account_ref !== route.accountBinding || selected !== route.selectedModelRef || actual !== route.selectedModelRef) blockers.push({ reason: "routing_evidence_identity_mismatch", detail: `Routing evidence ${route.evidenceId} does not match the provider result identity or account binding` });
    const below = MODEL_CAPABILITY_AXES.some((axis) => { const requirement = route.taskDemand.requirements[axis].level; const score = route.modelProfile.capability.axes[axis]; return score.status !== "scored" || score.score === null || score.score < requirement; });
    if (below) {
      const approval = route.approvalRef === null ? undefined : approvalById.get(route.approvalRef);
      const identity = route.approvalIdentity;
      const executionAt = new Date(binding.created_at).getTime();
      const claim = approval === undefined || identity === null ? undefined : input.claims.find((candidate) => candidate.approval_id === approval.approval_id && candidate.goal_id === input.goalId && candidate.project_id === input.projectId && candidate.capability_kind === identity.capabilityKind && candidate.command_id === identity.commandId && candidate.action === identity.action && candidate.target === identity.target);
      const claimAt = claim === undefined ? Number.NaN : new Date(claim.consumed_at).getTime();
      const validApproval = approval !== undefined && identity !== null && Number.isFinite(executionAt) && approval.goal_id === input.goalId && approval.project_id === input.projectId && approval.capability_kind === identity.capabilityKind && approval.command_id === identity.commandId && approval.action === identity.action && approval.target === identity.target && approval.decision === "approved" && approval.tier === route.decisionLayer && approval.scope_kind !== null && new Date(approval.created_at).getTime() <= executionAt && new Date(approval.expires_at).getTime() > executionAt && (approval.revoked_at === null || new Date(approval.revoked_at).getTime() > executionAt) && typeof approval.reason === "string" && approval.reason.trim() !== "" && typeof approval.consequence === "string" && approval.consequence.trim() !== "" && claim !== undefined && claim.policy_version === approval.policy_version && claimAt >= executionAt && claimAt <= new Date(route.createdAt).getTime();
      if (!validApproval) blockers.push({ reason: "routing_evidence_unapproved_below_requirement", detail: `Below-requirement model ${route.selectedModelRef} has no approval bound to the execution identity and time` });
    }
  }
  return { validRoutingEvidence, blockers };
}

/**
 * Generates Concertmaster's final report. Success is determined only by durable worker
 * outcomes/acceptances, a frozen Goal integration revision, and current
 * certification rows. Plan completion percentage and worker self-report are
 * never used as substitutes for those facts.
 */
async function generateConcertmasterFinalReportWithClient(pool: PoolClient, goalId: string, content?: EvidenceContentReader): Promise<ConcertmasterFinalReport> {
  // Final reports are immutable and unique per Goal. Return the committed
  // artifact on retries instead of creating another evidence snapshot.
  const existing = await pool.query<StoredConcertmasterFinalReport>("SELECT * FROM concertmaster_final_reports WHERE goal_id = $1", [goalId]);
  if (existing.rowCount === 1) return mapConcertmasterFinalReport(existing.rows[0]!);
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

  const goalIdentity = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
  const goalProjectId = goalIdentity.rows[0]?.project_id;
  const routingEvidence = await pool.query<RoutingEvidenceCertificationRow>(`SELECT evidence_id, goal_ref, project_ref, route_ref, mode, selected_model_ref,
             account_binding, candidate_refs, rejections, task_demand_hash, pressure,
             pressure_band, decision_layer, overlay_version, admission_binding_ref,
             rationale, evidence
        FROM ensemble_router_routing_evidence WHERE goal_ref = $1 ORDER BY created_at, evidence_id`, [goalId]);
  const nativeBindings = await pool.query<RoutingNativeBinding>(`SELECT binding_id, execution_ref, invocation_ref, goal_id, project_id, selected_model_provider,
             selected_model_id, actual_model_provider, actual_model_id, account_ref, created_at
        FROM native_execution_bindings WHERE goal_id = $1`, [goalId]);
  const capabilityApprovals = await pool.query<RoutingCapabilityApproval>(`SELECT approval.approval_id, approval.goal_id, approval.project_id, approval.policy_version, approval.capability_kind,
             approval.command_id, approval.action, approval.target, approval.tier, approval.approver_id,
             approval.decision, approval.created_at, approval.expires_at, approval.revoked_at, approval.reason, approval.consequence,
             budget.scope_kind, budget.remaining_count,
             budget.remaining_budget_cents, budget.expires_at AS repetition_expires_at
        FROM capability_approvals approval
        LEFT JOIN capability_repetition_budgets budget ON budget.approval_id = approval.approval_id
       WHERE approval.goal_id = $1`, [goalId]);
  const capabilityClaims = await pool.query<RoutingCapabilityClaim>(`SELECT claim_id, approval_id, capability_kind, project_id, goal_id, command_id, action, target, policy_version, consumed_at
        FROM capability_repetition_claims WHERE goal_id = $1`, [goalId]);
  const capabilityJournal = await pool.query<{ approval_id: string | null; event: string; details: Record<string, unknown> }>(
    `SELECT approval_id, event, details FROM capability_decision_journal WHERE goal_id = $1 ORDER BY recorded_at, journal_id`, [goalId],
  );
  const approvalById = new Map(capabilityApprovals.rows.map((row) => [row.approval_id, row] as const));
  const approvalJournalById = new Map<string, { event: string; details: Record<string, unknown> }[]>();
  for (const row of capabilityJournal.rows) {
    if (row.approval_id === null) continue;
    const entries = approvalJournalById.get(row.approval_id) ?? [];
    entries.push(row);
    approvalJournalById.set(row.approval_id, entries);
  }
  const routingLineage = evaluateRoutingEvidenceLineage({
    goalId, projectId: String(goalProjectId), routingRows: routingEvidence.rows,
    nativeBindings: nativeBindings.rows, approvals: capabilityApprovals.rows, claims: capabilityClaims.rows,
  });
  const validRoutingEvidence = routingLineage.validRoutingEvidence;
  const lineageBlockers = [...routingLineage.blockers];
  const snapshotContract = (council.snapshot_payload?.contract ?? {}) as { contractId?: string; version?: number; contentHash?: string };
  let contractHashValid = true;
  try {
    assertValidTaskContractSubstance(contractContent);
    contractHashValid = taskContractContentHash(contractContent) === expectedHash;
  } catch {
    contractHashValid = false;
  }
  if (snapshotContract.contractId !== council.contract_id || Number(snapshotContract.version) !== Number(contract.version) || snapshotContract.contentHash !== expectedHash || !contractHashValid || contract.launch_state !== "launched") {
    lineageBlockers.push({ reason: "certification_identity_mismatch", detail: "Resolved Council is not bound to the current launched Task Contract identity" });
  }
  const goalReservation = await pool.query<{ amount_cents: string }>("SELECT amount_cents FROM budget_reservations WHERE goal_id = $1 AND scope = 'goal' ORDER BY created_at DESC LIMIT 1", [goalId]);
  const actualCost = await pool.query<{ total: string }>("SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM goal_actual_costs WHERE goal_id = $1", [goalId]);
  const budgetCents = Number(goalReservation.rows[0]?.amount_cents ?? 0);
  const actualCostCents = Number(actualCost.rows[0]!.total);
  const evaluated = evaluateCertificationCompleteness({
    requiredKinds, records, openChallengeCount: Number(openChallenges.rows[0]!.count),
    expectedContractId: council.contract_id, expectedContractVersion: Number(contract.version), expectedContractContentHash: expectedHash,
    expectedIntegrationRevisionId: expectedRevisionId ?? "", expectedIntegratedCommitSha: expectedCommitSha ?? "",
    hasFrozenIntegratedRevision: frozenRevision,
    workers: workers.rows.map((worker) => ({ workerId: worker.worker_id, status: worker.status, hasDepartmentAcceptance: worker.acceptance_id !== null, acceptanceBoundToIntegratedRevision: worker.included })),
    unresolvedCertificationConflict: conflict && !conflictResolved,
    actualCostCents,
    budgetCents,
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


  const findings = await pool.query<{ rule_id: string; evidence_identity: string; resolved_at: Date | null }>("SELECT rule_id, evidence_identity, resolved_at FROM metronome_findings WHERE goal_id = $1", [goalId]);
  const incidents = findings.rows.map((row) => `${row.rule_id}: ${row.evidence_identity}`);
  const unresolvedLimitations = findings.rows.filter((row) => row.resolved_at === null).map((row) => `unresolved: ${row.rule_id} (${row.evidence_identity})`);
  const reportSections = renderRoutingReportSections({
    routingEvidence: validRoutingEvidence, approvals: approvalById, journalByApproval: approvalJournalById,
    journal: capabilityJournal.rows, packetDissent: packet?.dissent ?? [], limitations: unresolvedLimitations,
  });
  const approvalDecisions = reportSections.approvalDecisions;
  const interruptionIncidents = reportSections.interruptionIncidents;
  const dissent = reportSections.dissent;
  const waiverRows = await pool.query<{ reason: string; follow_up: string }>(
    `SELECT reason, follow_up FROM certification_waivers
      WHERE (certification_table = 'quality_certifications' AND certification_id IN (SELECT certification_id FROM quality_certifications WHERE goal_id = $1))
         OR (certification_table = 'conditional_certifications' AND certification_id IN (SELECT certification_id FROM conditional_certifications WHERE goal_id = $1))`, [goalId],
  );
  const knownLimitations = [...reportSections.knownLimitations, ...waiverRows.rows.map((row) => `waived: ${row.reason} (follow-up: ${row.follow_up})`)]
    .concat(conflict && !conflictResolved ? ["unresolved: conflicting certifications"] : []);
  const criticalActionAwaitingApproval = records.some((record) => record.hasUnwaivedCriticalFinding);

  // The evidence bundle is the immutable input snapshot and the final report
  // is the top-level artifact that points to it. Including the report inside
  // that same bundle would create a self-reference through evidenceBundleId;
  // both rows commit atomically below, so replay has an explicit link without
  // a circular hash.
  const { bundleId } = await recordEvidenceBundleInTransaction(pool, goalId, content);
  const reportId = randomUUID();
  await pool.query(
    `INSERT INTO concertmaster_final_reports (report_id, goal_id, success, blockers, ceo_request, what_changed, user_visible_behavior_passed, participating_departments, key_decisions, dissent, independent_validation, cost_cents, budget_cents, incidents, known_limitations, critical_action_awaiting_approval, evidence_bundle_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15::jsonb, $16, $17)`,
    [
      reportId, goalId, success, JSON.stringify(blockers), contractContent.desiredOutcome, whatChanged,
      latestByKind.get("quality")?.verdict === "passed", JSON.stringify(participatingDepartments),
      JSON.stringify([...(packet?.selectedDirection !== undefined ? [packet.selectedDirection] : []), ...approvalDecisions]), JSON.stringify(dissent),
      JSON.stringify(records.map((record) => `${record.kind}: ${record.verdict}`)),
      actualCostCents, budgetCents,
      JSON.stringify([...incidents, ...interruptionIncidents]), JSON.stringify(knownLimitations), criticalActionAwaitingApproval, bundleId,
    ],
  );

  return {
    reportId, goalId, success, blockers, ceoRequest: contractContent.desiredOutcome, whatChanged,
    userVisibleBehaviorPassed: latestByKind.get("quality")?.verdict === "passed", participatingDepartments,
    keyDecisions: [...(packet?.selectedDirection !== undefined ? [packet.selectedDirection] : []), ...approvalDecisions], dissent,
    independentValidation: records.map((record) => `${record.kind}: ${record.verdict}`),
    costCents: actualCostCents, budgetCents,
    incidents: [...incidents, ...interruptionIncidents], knownLimitations, criticalActionAwaitingApproval, evidenceBundleId: bundleId,
  };
}

/** Generates and stores the report while holding the Goal lease/control locks. */
export async function generateConcertmasterFinalReport(pool: Pool, goalId: string, proof: GoalLeaseProof, content?: EvidenceContentReader): Promise<ConcertmasterFinalReport> {
  if (proof.goalId !== goalId) throw new ConcertmasterReportError("Concertmaster report Goal identity mismatch");
  return withGoalAuthority(pool, proof, 42, (client) => generateConcertmasterFinalReportWithClient(client, goalId, content));
}

export async function readConcertmasterFinalReport(pool: Pool, reportId: string): Promise<ConcertmasterFinalReport> {
  const result = await pool.query<StoredConcertmasterFinalReport>("SELECT * FROM concertmaster_final_reports WHERE report_id = $1", [reportId]);
  if (result.rowCount !== 1) throw new ConcertmasterReportError(`Concertmaster final report not found: ${reportId}`);
  return mapConcertmasterFinalReport(result.rows[0]!);
}
