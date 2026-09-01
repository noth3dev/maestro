import { randomUUID } from "node:crypto";
import { detectMissingEvidenceFindings, detectMissingPlanItemFindings, detectStaleWorkerFindings, type DepartmentPlanItem, type SentinelFinding } from "@maestro/domain";
import type { Pool } from "pg";

export interface SentinelFindingRecord extends SentinelFinding {
  readonly findingId: string;
  readonly resolved: boolean;
}

interface FindingRow {
  finding_id: string; goal_id: string; rule_id: SentinelFinding["ruleId"]; evidence_identity: string;
  plan_version: number; details: Record<string, unknown>; resolved_at: Date | null;
}

function mapFinding(row: FindingRow): SentinelFindingRecord {
  return {
    findingId: row.finding_id, goalId: row.goal_id, ruleId: row.rule_id, evidenceIdentity: row.evidence_identity,
    planVersion: row.plan_version, details: row.details, resolved: row.resolved_at !== null,
  };
}

/**
 * Scans one Goal's durable state and records any newly detected findings.
 * Deterministic rules only (plan/phase3.md work-sequence step 1); model
 * judgment for semantic ambiguity is a later step. Idempotent: re-scanning
 * an unchanged Goal records nothing new (unique identity per rule/evidence/
 * plan-version), matching the required "deduplicate by Goal, rule, evidence
 * identity, and active plan version".
 */
export async function scanGoalForSentinelFindings(pool: Pool, goalId: string): Promise<readonly SentinelFindingRecord[]> {
  const plans = await pool.query<{ department_id: string; current_version: number; substance: { items: readonly DepartmentPlanItem[] } }>(
    "SELECT department_id, current_version, substance FROM department_plans WHERE goal_id = $1",
    [goalId],
  );
  const currentPlanVersionByDepartment = new Map(plans.rows.map((row) => [row.department_id, row.current_version] as const));
  const currentPlanItemsByDepartment = new Map(plans.rows.map((row) => [
    row.department_id,
    { version: row.current_version, itemIds: new Set(row.substance.items.map((item) => item.itemId)) },
  ] as const));

  const workers = await pool.query<{ worker_id: string; department_id: string; plan_version: number; item_id: string }>(
    `SELECT w.worker_id, w.department_id, w.plan_version, w.item_id
       FROM workers w
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
      WHERE dp.goal_id = $1`,
    [goalId],
  );
  const workerFacts = workers.rows.map((row) => ({ workerId: row.worker_id, departmentId: row.department_id, planVersion: row.plan_version, itemId: row.item_id }));

  const project = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
  const projectId = project.rows[0]?.project_id;
  const durableEvidence = projectId === undefined
    ? new Set<string>()
    : new Set((await pool.query<{ evidence_id: string; sha256: string }>("SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [goalId, projectId])).rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));

  const referencedEvidence = await pool.query<{ evidence_references: string[] }>(
    `SELECT ic.evidence_references
       FROM integration_commits ic
       JOIN workers w ON w.worker_id = ic.worker_id
       JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
      WHERE dp.goal_id = $1`,
    [goalId],
  );
  const allReferences = referencedEvidence.rows.flatMap((row) => row.evidence_references);
  const currentMaxPlanVersion = Math.max(0, ...[...currentPlanVersionByDepartment.values()]);

  const findings = [
    ...detectStaleWorkerFindings(goalId, currentPlanVersionByDepartment, workerFacts),
    ...detectMissingPlanItemFindings(goalId, currentPlanItemsByDepartment, workerFacts),
    ...detectMissingEvidenceFindings(goalId, currentMaxPlanVersion, allReferences, durableEvidence),
  ];

  const recorded: SentinelFindingRecord[] = [];
  for (const finding of findings) {
    const inserted = await pool.query<FindingRow>(
      `INSERT INTO sentinel_findings (finding_id, goal_id, rule_id, evidence_identity, plan_version, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (goal_id, rule_id, evidence_identity, plan_version) DO NOTHING
       RETURNING finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at`,
      [randomUUID(), finding.goalId, finding.ruleId, finding.evidenceIdentity, finding.planVersion, JSON.stringify(finding.details)],
    );
    if (inserted.rowCount === 1) recorded.push(mapFinding(inserted.rows[0]!));
  }
  return recorded;
}

export async function listSentinelFindings(pool: Pool, goalId: string, includeResolved = false): Promise<readonly SentinelFindingRecord[]> {
  const result = await pool.query<FindingRow>(
    includeResolved
      ? "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM sentinel_findings WHERE goal_id = $1 ORDER BY detected_at"
      : "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM sentinel_findings WHERE goal_id = $1 AND resolved_at IS NULL ORDER BY detected_at",
    [goalId],
  );
  return result.rows.map(mapFinding);
}

export class SentinelFindingNotFoundError extends Error {}
export class SentinelFindingError extends Error {}

/** Resolving a finding is a one-way, auditable action; it requires a nonblank reason and is immutable once applied. */
export async function resolveSentinelFinding(pool: Pool, findingId: string, reason: string): Promise<SentinelFindingRecord> {
  if (reason.trim() === "") throw new SentinelFindingError("A Sentinel finding resolution requires a nonblank reason");
  const current = await pool.query<FindingRow>("SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM sentinel_findings WHERE finding_id = $1", [findingId]);
  if (current.rowCount !== 1) throw new SentinelFindingNotFoundError(`Sentinel finding not found: ${findingId}`);
  if (current.rows[0]!.resolved_at !== null) return mapFinding(current.rows[0]!);
  const updated = await pool.query<FindingRow>(
    "UPDATE sentinel_findings SET resolved_at = transaction_timestamp(), resolution_reason = $2 WHERE finding_id = $1 RETURNING finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at",
    [findingId, reason.trim()],
  );
  return mapFinding(updated.rows[0]!);
}
