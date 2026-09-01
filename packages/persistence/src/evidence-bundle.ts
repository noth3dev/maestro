import { randomUUID } from "node:crypto";
import { assertEvidenceBundleIntegrity, evidenceBundleContentHash, type EvidenceBundle } from "@maestro/domain";
import type { Pool } from "pg";

export class EvidenceBundleError extends Error {}
export class EvidenceBundleNotFoundError extends EvidenceBundleError {}

/**
 * Assembles the durable evidence bundle for one Goal by reading already-
 * durable records across every subsystem built so far. This is a read-only
 * aggregation: it invents nothing and computes no new judgment.
 */
export async function assembleEvidenceBundle(pool: Pool, goalId: string): Promise<{ bundle: Omit<EvidenceBundle, "assembledAt">; hash: string }> {
  const goal = await pool.query("SELECT 1 FROM goals WHERE goal_id = $1", [goalId]);
  if (goal.rowCount !== 1) throw new EvidenceBundleError("Goal not found for evidence bundle assembly");

  const council = await pool.query<Record<string, unknown>>(
    "SELECT council_id, contract_id, state, decision_packet, snapshot_hash FROM head_councils WHERE goal_id = $1 ORDER BY created_at DESC LIMIT 1",
    [goalId],
  );
  const contractId = council.rows[0]?.contract_id as string | undefined;
  const taskContract = contractId === undefined
    ? null
    : (await pool.query<Record<string, unknown>>("SELECT contract_id, version, content_hash, launch_state FROM task_contracts WHERE contract_id = $1", [contractId])).rows[0] ?? null;

  const departmentPlans = (await pool.query<Record<string, unknown>>(
    "SELECT council_id, department_id, current_version, content_hash FROM department_plans WHERE goal_id = $1",
    [goalId],
  )).rows;

  const workers = (await pool.query<Record<string, unknown>>(
    `SELECT w.worker_id, w.department_id, w.plan_version, w.item_id, w.status, w.attempt
       FROM workers w
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
      WHERE dp.goal_id = $1`,
    [goalId],
  )).rows;

  const goalBranch = (await pool.query<Record<string, unknown>>("SELECT branch_name, base_revision FROM goal_integration_branches WHERE goal_id = $1", [goalId])).rows[0] ?? null;
  const departmentBranches = (await pool.query<Record<string, unknown>>("SELECT department_id, branch_name FROM department_branches WHERE goal_id = $1", [goalId])).rows;
  const commits = (await pool.query<Record<string, unknown>>(
    `SELECT ic.worker_id, ic.commit_sha, ic.message
       FROM integration_commits ic
       JOIN workers w ON w.worker_id = ic.worker_id
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
      WHERE dp.goal_id = $1`,
    [goalId],
  )).rows;

  const qualityCertifications = (await pool.query<Record<string, unknown>>("SELECT certification_id, verdict, certified_by_department, producing_department FROM quality_certifications WHERE goal_id = $1", [goalId])).rows;
  const conditionalCertifications = (await pool.query<Record<string, unknown>>("SELECT certification_id, kind, verdict, certified_by_department, producing_department FROM conditional_certifications WHERE goal_id = $1", [goalId])).rows;
  const acceptances = (await pool.query<Record<string, unknown>>(
    `SELECT da.worker_id, da.commit_sha, da.accepted_by
       FROM department_acceptances da
       JOIN workers w ON w.worker_id = da.worker_id
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
      WHERE dp.goal_id = $1`,
    [goalId],
  )).rows;

  const sentinelFindings = (await pool.query<Record<string, unknown>>("SELECT finding_id, rule_id, evidence_identity, resolved_at FROM sentinel_findings WHERE goal_id = $1", [goalId])).rows;
  const sentinelChallenges = (await pool.query<Record<string, unknown>>("SELECT challenge_id, status, raised_by, resolved_by FROM sentinel_challenges WHERE goal_id = $1", [goalId])).rows;
  const overwatchRounds = (await pool.query<Record<string, unknown>>(
    `SELECT r.round_id, r.question, s.final_verdict, s.same_model_only, s.escalated
       FROM overwatch_council_rounds r
       LEFT JOIN overwatch_council_syntheses s ON s.round_id = r.round_id
      WHERE r.goal_id = $1`,
    [goalId],
  )).rows;
  const budgetReservations = (await pool.query<Record<string, unknown>>("SELECT reservation_id, scope, department_id, amount_cents, ceo_approved FROM budget_reservations WHERE goal_id = $1", [goalId])).rows;

  const bundle: Omit<EvidenceBundle, "assembledAt"> = {
    goalId,
    taskContract,
    council: council.rows[0] ?? null,
    departmentPlans,
    workers,
    gitIntegration: { goalBranch, departmentBranches, commits },
    certifications: { quality: qualityCertifications, conditional: conditionalCertifications, acceptances },
    sentinelFindings,
    sentinelChallenges,
    overwatchRounds,
    budgetReservations,
  };
  const hash = evidenceBundleContentHash(bundle);
  return { bundle, hash };
}

/** Assembles and durably records one evidence bundle snapshot. Immutable once written; a later re-assembly is a new row. */
export async function recordEvidenceBundle(pool: Pool, goalId: string): Promise<{ bundleId: string; hash: string }> {
  const { bundle, hash } = await assembleEvidenceBundle(pool, goalId);
  const bundleId = randomUUID();
  await pool.query(
    "INSERT INTO evidence_bundles (bundle_id, goal_id, content, content_hash) VALUES ($1, $2, $3::jsonb, $4)",
    [bundleId, goalId, JSON.stringify(bundle), hash],
  );
  return { bundleId, hash };
}

/** Re-reads a recorded bundle and verifies its stored hash still matches the content actually stored (not a re-assembly from current live state -- a durable artifact must not silently drift). */
export async function verifyStoredEvidenceBundle(pool: Pool, bundleId: string): Promise<void> {
  const result = await pool.query<{ content: Omit<EvidenceBundle, "assembledAt">; content_hash: string }>("SELECT content, content_hash FROM evidence_bundles WHERE bundle_id = $1", [bundleId]);
  if (result.rowCount !== 1) throw new EvidenceBundleNotFoundError(`Evidence bundle not found: ${bundleId}`);
  assertEvidenceBundleIntegrity(result.rows[0]!.content, result.rows[0]!.content_hash);
}

export async function readEvidenceBundle(pool: Pool, bundleId: string): Promise<{ bundleId: string; goalId: string; content: Omit<EvidenceBundle, "assembledAt">; hash: string }> {
  const result = await pool.query<{ goal_id: string; content: Omit<EvidenceBundle, "assembledAt">; content_hash: string }>("SELECT goal_id, content, content_hash FROM evidence_bundles WHERE bundle_id = $1", [bundleId]);
  if (result.rowCount !== 1) throw new EvidenceBundleNotFoundError(`Evidence bundle not found: ${bundleId}`);
  return { bundleId, goalId: result.rows[0]!.goal_id, content: result.rows[0]!.content, hash: result.rows[0]!.content_hash };
}
