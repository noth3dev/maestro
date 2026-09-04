import { randomUUID } from "node:crypto";
import { detectMissingEvidenceFindings, detectMissingPlanItemFindings, detectStaleWorkerFindings, normalizeMetronomeIdentity, type DepartmentPlanItem, type MetronomeFinding } from "@maestro/domain";
import type { Pool } from "pg";
import { assertMetronomeMutationAuthorized, requireMetronomeAuthorization, type MetronomeActorContext } from "./metronome-challenge.js";
import type { GoalLeaseProof } from "./commands.js";

export interface MetronomeFindingRecord extends MetronomeFinding {
  readonly findingId: string;
  readonly resolved: boolean;
}

interface FindingRow {
  finding_id: string; goal_id: string; rule_id: MetronomeFinding["ruleId"]; evidence_identity: string;
  plan_version: number; details: Record<string, unknown>; resolved_at: Date | null;
}

function mapFinding(row: FindingRow): MetronomeFindingRecord {
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
export async function scanGoalForMetronomeFindings(
  pool: Pool,
  goalId: string,
  proof: GoalLeaseProof,
  context: MetronomeActorContext,
): Promise<readonly MetronomeFindingRecord[]> {
  const normalizedGoalId = normalizeMetronomeIdentity(goalId);
  const authorization = requireMetronomeAuthorization(proof, context);
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await assertMetronomeMutationAuthorized(client, normalizedGoalId, authorization.proof, authorization.context, "metronome");

    const plans = await client.query<{ department_id: string; current_version: number; substance: { items: readonly DepartmentPlanItem[] } }>(
      "SELECT department_id, current_version, substance FROM department_plans WHERE goal_id = $1",
      [normalizedGoalId],
    );
    const currentPlanVersionByDepartment = new Map(plans.rows.map((row) => [row.department_id, row.current_version] as const));
    const currentPlanItemsByDepartment = new Map(plans.rows.map((row) => [
      row.department_id,
      { version: row.current_version, itemIds: new Set(row.substance.items.map((item) => item.itemId)) },
    ] as const));

    const workers = await client.query<{ worker_id: string; department_id: string; plan_version: number; item_id: string }>(
      `SELECT w.worker_id, w.department_id, w.plan_version, w.item_id
         FROM workers w
         JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        WHERE dp.goal_id = $1`,
      [normalizedGoalId],
    );
    const workerFacts = workers.rows.map((row) => ({ workerId: row.worker_id, departmentId: row.department_id, planVersion: row.plan_version, itemId: row.item_id }));

    const project = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1 FOR KEY SHARE", [normalizedGoalId]);
    const projectId = project.rows[0]?.project_id;
    const durableEvidence = projectId === undefined
      ? new Set<string>()
      : new Set((await client.query<{ evidence_id: string; sha256: string }>("SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [normalizedGoalId, projectId])).rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));

    const referencedEvidence = await client.query<{ evidence_references: string[] }>(
      `SELECT ic.evidence_references
         FROM integration_commits ic
         JOIN workers w ON w.worker_id = ic.worker_id
         JOIN department_plans dp ON dp.council_id = w.council_id AND dp.department_id = w.department_id
        WHERE dp.goal_id = $1`,
      [normalizedGoalId],
    );
    const allReferences = referencedEvidence.rows.flatMap((row) => row.evidence_references);
    const currentMaxPlanVersion = Math.max(0, ...[...currentPlanVersionByDepartment.values()]);

    const findings = [
      ...detectStaleWorkerFindings(normalizedGoalId, currentPlanVersionByDepartment, workerFacts),
      ...detectMissingPlanItemFindings(normalizedGoalId, currentPlanItemsByDepartment, workerFacts),
      ...detectMissingEvidenceFindings(normalizedGoalId, currentMaxPlanVersion, allReferences, durableEvidence),
    ];

    const recorded: MetronomeFindingRecord[] = [];
    for (const finding of findings) {
      const inserted = await client.query<FindingRow>(
        `INSERT INTO metronome_findings (finding_id, goal_id, rule_id, evidence_identity, plan_version, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (goal_id, rule_id, evidence_identity, plan_version) DO NOTHING
         RETURNING finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at`,
        [randomUUID(), finding.goalId, finding.ruleId, finding.evidenceIdentity, finding.planVersion, JSON.stringify(finding.details)],
      );
      if (inserted.rowCount === 1) recorded.push(mapFinding(inserted.rows[0]!));
    }
    await client.query("COMMIT");
    open = false;
    return recorded;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listMetronomeFindings(pool: Pool, goalId: string, includeResolved = false): Promise<readonly MetronomeFindingRecord[]> {
  const result = await pool.query<FindingRow>(
    includeResolved
      ? "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM metronome_findings WHERE goal_id = $1 ORDER BY detected_at"
      : "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM metronome_findings WHERE goal_id = $1 AND resolved_at IS NULL ORDER BY detected_at",
    [goalId],
  );
  return result.rows.map(mapFinding);
}

export class MetronomeFindingNotFoundError extends Error {}
export class MetronomeFindingError extends Error {}

/** Resolving a finding is a one-way, auditable action; it requires a nonblank reason, a current Goal lease, and an authorized resolver identity/session. */
export async function resolveMetronomeFinding(
  pool: Pool,
  findingId: string,
  reason: string,
  proof: GoalLeaseProof,
  context: MetronomeActorContext,
): Promise<MetronomeFindingRecord> {
  if (reason.trim() === "") throw new MetronomeFindingError("A Metronome finding resolution requires a nonblank reason");
  const authorization = requireMetronomeAuthorization(proof, context);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const candidate = await client.query<FindingRow>(
      "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM metronome_findings WHERE finding_id = $1",
      [findingId.trim()],
    );
    if (candidate.rowCount !== 1) throw new MetronomeFindingNotFoundError(`Metronome finding not found: ${findingId}`);
    await assertMetronomeMutationAuthorized(client, candidate.rows[0]!.goal_id, authorization.proof, authorization.context, "resolver");
    const current = await client.query<FindingRow>(
      "SELECT finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at FROM metronome_findings WHERE finding_id = $1 FOR UPDATE",
      [findingId.trim()],
    );
    if (current.rowCount !== 1) throw new MetronomeFindingNotFoundError(`Metronome finding not found: ${findingId}`);
    const finding = current.rows[0]!;
    if (finding.resolved_at !== null) {
      await client.query("COMMIT"); open = false;
      return mapFinding(finding);
    }
    const updated = await client.query<FindingRow>(
      "UPDATE metronome_findings SET resolved_at = transaction_timestamp(), resolution_reason = $2 WHERE finding_id = $1 RETURNING finding_id, goal_id, rule_id, evidence_identity, plan_version, details, resolved_at",
      [findingId.trim(), reason.trim()],
    );
    await client.query("COMMIT"); open = false;
    return mapFinding(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
