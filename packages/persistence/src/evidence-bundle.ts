import { randomUUID } from "node:crypto";
import { assertEvidenceBundleIntegrity, evidenceBundleContentHash, type EvidenceBundle } from "@maestro/domain";
import { verifyEvidenceRecord, type EvidenceContentReader } from "@maestro/evidence";
import type { Pool } from "pg";

export class EvidenceBundleError extends Error {}
export class EvidenceBundleNotFoundError extends EvidenceBundleError {}

/**
 * Assembles the durable evidence bundle for one Goal by reading already-
 * durable records across every subsystem built so far. This is a read-only
 * aggregation: it invents nothing and computes no new judgment.
 */
export async function assembleEvidenceBundle(pool: Pool, goalId: string, content?: EvidenceContentReader): Promise<{ bundle: Omit<EvidenceBundle, "assembledAt">; hash: string }> {
  const goal = await pool.query<Record<string, unknown>>("SELECT goal_id, project_id, state, version, created_at, updated_at FROM goals WHERE goal_id = $1", [goalId]);
  if (goal.rowCount !== 1) throw new EvidenceBundleError("Goal not found for evidence bundle assembly");
  const projectId = goal.rows[0]!.project_id;

  const council = await pool.query<Record<string, unknown>>(
    `SELECT council_id, goal_id, contract_id, brief_deadline, state, no_new_evidence_streak,
            decision_packet, snapshot_hash, snapshot_payload, created_at, closed_at
       FROM head_councils WHERE goal_id = $1 ORDER BY created_at DESC, council_id DESC LIMIT 1`, [goalId],
  );
  const councilRow = council.rows[0] ?? null;
  const contractId = councilRow?.contract_id as string | undefined;
  const taskContract = contractId === undefined
    ? null
    : (await pool.query<Record<string, unknown>>(
      `SELECT contract_id, schema_version, version, content, content_hash, launch_state,
              created_at, updated_at FROM task_contracts WHERE contract_id = $1`, [contractId],
    )).rows[0] ?? null;

  const departmentPlans = (await pool.query<Record<string, unknown>>(
    `SELECT council_id, department_id, project_id, goal_id, head_role_id,
            council_snapshot_hash, decision_packet_hash, contract_id, contract_version,
            contract_content_hash, current_version, substance, content_hash, created_at, updated_at
       FROM department_plans WHERE goal_id = $1 ORDER BY department_id`, [goalId],
  )).rows;
  const departmentPlanRevisions = (await pool.query<Record<string, unknown>>(
    `SELECT revision_id, council_id, department_id, version, substance, content_hash,
            reason, affected_item_ids, actor_id, session_ref, recorded_at
       FROM department_plan_revisions WHERE council_id IN (SELECT council_id FROM department_plans WHERE goal_id = $1)
       ORDER BY department_id, version`, [goalId],
  )).rows;

  const workers = (await pool.query<Record<string, unknown>>(
    `SELECT w.worker_id, w.council_id, w.department_id, w.plan_version, w.item_id,
            w.bundle_content_hash, w.attempt, w.execution_ref, w.invocation_ref, w.status,
            w.answer_text, w.usage_total_tokens, w.spawned_at, w.observed_at,
            mb.bundle_id, mb.parent_ref, mb.content_hash AS bundle_hash
       FROM workers w
       JOIN department_plans dp
         ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        AND dp.goal_id = $1
       LEFT JOIN mission_bundles mb
         ON mb.council_id = w.council_id AND mb.department_id = w.department_id
        AND mb.plan_version = w.plan_version AND mb.item_id = w.item_id
      ORDER BY w.department_id, w.item_id, w.attempt, w.worker_id`, [goalId],
  )).rows;

  const goalBranch = (await pool.query<Record<string, unknown>>(
    "SELECT goal_id, repository_path, branch_name, base_revision, created_at, retention FROM goal_integration_branches WHERE goal_id = $1", [goalId],
  )).rows[0] ?? null;
  const departmentBranches = (await pool.query<Record<string, unknown>>(
    "SELECT goal_id, department_id, repository_path, branch_name, base_branch_name, created_at, retention FROM department_branches WHERE goal_id = $1 ORDER BY department_id", [goalId],
  )).rows;
  const workerWorktrees = (await pool.query<Record<string, unknown>>(
    `SELECT wt.worker_id, wt.repository_path, wt.worktree_path, wt.branch_name,
            wt.base_branch_name, wt.created_at, wt.retention
       FROM worker_worktrees wt JOIN workers w ON w.worker_id = wt.worker_id
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        AND dp.goal_id = $1 ORDER BY wt.worker_id`, [goalId],
  )).rows;
  const commits = (await pool.query<Record<string, unknown>>(
    `SELECT ic.commit_id, ic.worker_id, ic.commit_sha, ic.message, ic.evidence_references,
            ic.recorded_at, ic.retention
       FROM integration_commits ic
       JOIN workers w ON w.worker_id = ic.worker_id
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        AND dp.goal_id = $1 ORDER BY ic.recorded_at, ic.commit_id`, [goalId],
  )).rows;
  const integrationRevisions = (await pool.query<Record<string, unknown>>(
    `SELECT revision_id, revision_number, goal_id, repository_path, branch_name,
            commit_sha, base_revision, recorded_at, retention
       FROM goal_integration_revisions WHERE goal_id = $1 ORDER BY revision_number`, [goalId],
  )).rows;
  const integrationRevisionCommits = (await pool.query<Record<string, unknown>>(
    `SELECT member.revision_id, member.worker_id, member.commit_sha, member.recorded_at, member.retention
       FROM goal_integration_revision_commits member
       JOIN goal_integration_revisions revision ON revision.revision_id = member.revision_id
      WHERE revision.goal_id = $1 ORDER BY revision.revision_number, member.worker_id, member.commit_sha`, [goalId],
  )).rows;

  const qualityCertifications = (await pool.query<Record<string, unknown>>(
    `SELECT certification_id, goal_id, contract_id, contract_version, contract_content_hash,
            integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
            verdict, findings, test_evidence_ids, certified_by_department,
            producing_department, created_at, retention
       FROM quality_certifications WHERE goal_id = $1 ORDER BY created_at, certification_id`, [goalId],
  )).rows;
  const conditionalCertifications = (await pool.query<Record<string, unknown>>(
    `SELECT certification_id, kind, goal_id, contract_id, contract_version, contract_content_hash,
            integrated_commit_sha, worker_id, department_acceptance_id, integration_revision_id,
            verdict, findings, test_evidence_ids, certified_by_department,
            producing_department, created_at, retention
       FROM conditional_certifications WHERE goal_id = $1 ORDER BY kind, created_at, certification_id`, [goalId],
  )).rows;
  const acceptances = (await pool.query<Record<string, unknown>>(
    `SELECT da.acceptance_id, da.worker_id, da.commit_sha, da.reason, da.accepted_by,
            da.session_ref, da.created_at, da.retention
       FROM department_acceptances da
       JOIN workers w ON w.worker_id = da.worker_id
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        AND dp.goal_id = $1 ORDER BY da.created_at, da.acceptance_id`, [goalId],
  )).rows;
  const waivers = (await pool.query<Record<string, unknown>>(
    `SELECT waiver.waiver_id, waiver.certification_table, waiver.certification_id,
            waiver.finding_id, waiver.authority, waiver.reason, waiver.consequence,
            waiver.follow_up, waiver.granted_by, waiver.expires_at, waiver.created_at,
            waiver.retention, cert.goal_id
       FROM certification_waivers waiver
       JOIN quality_certifications cert
         ON waiver.certification_table = 'quality_certifications'
        AND waiver.certification_id = cert.certification_id
      WHERE cert.goal_id = $1
     UNION ALL
     SELECT waiver.waiver_id, waiver.certification_table, waiver.certification_id,
            waiver.finding_id, waiver.authority, waiver.reason, waiver.consequence,
            waiver.follow_up, waiver.granted_by, waiver.expires_at, waiver.created_at,
            waiver.retention, cert.goal_id
       FROM certification_waivers waiver
       JOIN conditional_certifications cert
         ON waiver.certification_table = 'conditional_certifications'
        AND waiver.certification_id = cert.certification_id
      WHERE cert.goal_id = $1`, [goalId],
  )).rows;
  const conflictResolutions = (await pool.query<Record<string, unknown>>(
    `SELECT resolution.resolution_id, resolution.goal_id, resolution.round_id,
            resolution.conflicting_verdicts, resolution.resolution_verdict,
            resolution.contract_id, resolution.contract_version, resolution.contract_content_hash,
            resolution.integration_revision_id, resolution.integrated_commit_sha,
            resolution.created_at, resolution.retention,
            COALESCE((SELECT jsonb_agg(to_jsonb(member) ORDER BY member.member_id)
                        FROM certification_conflict_resolution_members member
                       WHERE member.resolution_id = resolution.resolution_id), '[]'::jsonb) AS members
       FROM certification_conflict_resolutions resolution WHERE resolution.goal_id = $1
       ORDER BY resolution.created_at, resolution.resolution_id`, [goalId],
  )).rows;

  const sentinelFindings = (await pool.query<Record<string, unknown>>(
    "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, detected_at, resolved_at, resolution_reason, retention FROM sentinel_findings WHERE goal_id = $1 ORDER BY detected_at, finding_id", [goalId],
  )).rows;
  const sentinelChallenges = (await pool.query<Record<string, unknown>>(
    `SELECT challenge.challenge_id, challenge.goal_id, challenge.reason, challenge.evidence_references,
            challenge.status, challenge.correction_request, challenge.raised_by,
            challenge.resolved_by, challenge.resolution_reason, challenge.created_at,
            challenge.resolved_at, challenge.retention,
            COALESCE((SELECT jsonb_agg(link.finding_id ORDER BY link.finding_id)
                        FROM sentinel_challenge_findings link
                       WHERE link.challenge_id = challenge.challenge_id), '[]'::jsonb) AS finding_ids
       FROM sentinel_challenges challenge WHERE challenge.goal_id = $1
       ORDER BY challenge.created_at, challenge.challenge_id`, [goalId],
  )).rows;
  const encoreRounds = (await pool.query<Record<string, unknown>>(
    `SELECT round.round_id, round.goal_id, round.question, round.criteria, round.evidence_ids,
            round.trigger_reasons, round.reviewer_count, round.created_at, round.retention,
            synthesis.final_verdict, synthesis.same_model_only, synthesis.escalated,
            synthesis.dissent_notes, synthesis.created_at AS synthesis_created_at,
            COALESCE((SELECT jsonb_agg(to_jsonb(judgment) ORDER BY judgment.reviewer_index)
                        FROM encore_council_judgments judgment
                       WHERE judgment.round_id = round.round_id), '[]'::jsonb) AS judgments
       FROM encore_council_rounds round
       LEFT JOIN encore_council_syntheses synthesis ON synthesis.round_id = round.round_id
      WHERE round.goal_id = $1 ORDER BY round.created_at, round.round_id`, [goalId],
  )).rows;
  const budgetReservations = (await pool.query<Record<string, unknown>>(
    "SELECT reservation_id, goal_id, scope, department_id, amount_cents, ceo_approved, created_at, retention FROM budget_reservations WHERE goal_id = $1 ORDER BY created_at, reservation_id", [goalId],
  )).rows;
  const evidenceRecords = (await pool.query<Record<string, unknown>>(
    `SELECT evidence_id, correlation_id, command_id, project_id, goal_id, actor_id,
            sha256, byte_length, kind, media_type, created_at, record_version, retention
       FROM evidence_records WHERE goal_id = $1 AND project_id = $2
       ORDER BY created_at, evidence_id`, [goalId, projectId],
  )).rows;
  // Only ever a real defense-in-depth check when a caller supplies a real
  // content reader (e.g. the production evidence store); it verifies every
  // evidence artifact this bundle is about to durably reference still
  // matches its recorded sha256/byteLength, catching corruption or a
  // repointed metadata row before it is ever baked into an immutable bundle.
  if (content) {
    for (const row of evidenceRecords) {
      await verifyEvidenceRecord({ sha256: row.sha256 as string, byteLength: Number(row.byte_length) }, content);
    }
  }

  const bundle: Omit<EvidenceBundle, "assembledAt"> = {
    goalId,
    taskContract,
    council: councilRow,
    departmentPlans,
    departmentPlanRevisions,
    workers,
    gitIntegration: { goalBranch, departmentBranches, workerWorktrees, commits, revisions: integrationRevisions, revisionCommits: integrationRevisionCommits },
    certifications: { quality: qualityCertifications, conditional: conditionalCertifications, acceptances, waivers, conflictResolutions },
    sentinelFindings,
    sentinelChallenges,
    encoreRounds,
    budgetReservations,
    evidenceRecords,
  };
  const hash = evidenceBundleContentHash(bundle);
  return { bundle, hash };
}

/** Assembles and durably records one evidence bundle snapshot. Immutable once written; a later re-assembly is a new row. */
export async function recordEvidenceBundle(pool: Pool, goalId: string, content?: EvidenceContentReader): Promise<{ bundleId: string; hash: string }> {
  const { bundle, hash } = await assembleEvidenceBundle(pool, goalId, content);
  if (bundle.goalId !== goalId) throw new EvidenceBundleError("Evidence bundle Goal identity mismatch");
  const bundleId = randomUUID();
  await pool.query(
    "INSERT INTO evidence_bundles (bundle_id, goal_id, content, content_hash) VALUES ($1, $2, $3::jsonb, $4)",
    [bundleId, goalId, JSON.stringify(bundle), hash],
  );
  return { bundleId, hash };
}

/** Re-reads a recorded bundle and verifies its stored hash still matches the content actually stored (not a re-assembly from current live state -- a durable artifact must not silently drift). */
export async function verifyStoredEvidenceBundle(pool: Pool, bundleId: string): Promise<void> {
  const result = await pool.query<{ goal_id: string; content: Omit<EvidenceBundle, "assembledAt">; content_hash: string }>("SELECT goal_id, content, content_hash FROM evidence_bundles WHERE bundle_id = $1", [bundleId]);
  if (result.rowCount !== 1) throw new EvidenceBundleNotFoundError(`Evidence bundle not found: ${bundleId}`);
  if (result.rows[0]!.content.goalId !== result.rows[0]!.goal_id) throw new EvidenceBundleError("Evidence bundle content is bound to a different Goal");
  assertEvidenceBundleIntegrity(result.rows[0]!.content, result.rows[0]!.content_hash);
}

export async function readEvidenceBundle(pool: Pool, bundleId: string): Promise<{ bundleId: string; goalId: string; content: Omit<EvidenceBundle, "assembledAt">; hash: string }> {
  const result = await pool.query<{ goal_id: string; content: Omit<EvidenceBundle, "assembledAt">; content_hash: string }>("SELECT goal_id, content, content_hash FROM evidence_bundles WHERE bundle_id = $1", [bundleId]);
  if (result.rowCount !== 1) throw new EvidenceBundleNotFoundError(`Evidence bundle not found: ${bundleId}`);
  if (result.rows[0]!.content.goalId !== result.rows[0]!.goal_id) throw new EvidenceBundleError("Evidence bundle content is bound to a different Goal");
  assertEvidenceBundleIntegrity(result.rows[0]!.content, result.rows[0]!.content_hash);
  return { bundleId, goalId: result.rows[0]!.goal_id, content: result.rows[0]!.content, hash: result.rows[0]!.content_hash };
}
