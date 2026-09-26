import type { Pool } from "pg";
import {
  assertValidGoalPlan,
  goalPlanContentHash,
  type GoalPlanSliceStatus,
  type GoalPlanStatus,
  type GoalPlanSubstance,
} from "@maestro/domain";

export class GoalPlanNotFoundError extends Error {
  constructor() {
    super("Goal plan not found");
    this.name = "GoalPlanNotFoundError";
  }
}

export interface GoalPlanRecord {
  readonly goalId: string;
  readonly projectId: string;
  readonly version: number;
  readonly status: GoalPlanStatus;
  readonly councilId: string | null;
  readonly contentHash: string;
  readonly approvalRef: string | null;
  readonly phases: GoalPlanSubstance["phases"];
  readonly slices: ReadonlyArray<GoalPlanSubstance["slices"][number] & { readonly status: GoalPlanSliceStatus; readonly statusReason: string | null }>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Store a new plan version for a Goal (as a draft). Earlier drafts and plans
 * awaiting approval are superseded; an approved plan stays until a newer
 * version is approved. Replaying the same command returns the stored version.
 */
export async function createGoalPlanVersion(
  pool: Pool,
  input: { readonly goalId: string; readonly projectId: string; readonly councilId: string | null; readonly plan: GoalPlanSubstance; readonly commandId: string },
): Promise<GoalPlanRecord> {
  assertValidGoalPlan(input.plan);
  const contentHash = goalPlanContentHash(input.plan);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('goal-plan:' || $1, 0))", [input.goalId]);
    const prior = await client.query<{ version: number; goal_id: string; content_hash: string }>(
      "SELECT version, goal_id, content_hash FROM goal_plans WHERE command_id = $1",
      [input.commandId],
    );
    if (prior.rowCount === 1) {
      if (prior.rows[0]!.goal_id !== input.goalId || prior.rows[0]!.content_hash.trim() !== contentHash)
        throw new Error("Goal plan command identity was reused with a different plan");
      await client.query("COMMIT");
      return readGoalPlanVersion(pool, input.goalId, input.projectId, prior.rows[0]!.version);
    }
    const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [input.goalId]);
    if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== input.projectId) throw new GoalPlanNotFoundError();
    const next = await client.query<{ version: number }>("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM goal_plans WHERE goal_id = $1", [input.goalId]);
    const version = Number(next.rows[0]!.version);
    await client.query(
      "UPDATE goal_plans SET status = 'superseded', updated_at = transaction_timestamp() WHERE goal_id = $1 AND status IN ('draft', 'awaiting_approval')",
      [input.goalId],
    );
    await client.query(
      "INSERT INTO goal_plans (goal_id, project_id, version, status, council_id, content_hash, command_id) VALUES ($1, $2, $3, 'draft', $4, $5, $6)",
      [input.goalId, input.projectId, version, input.councilId, contentHash, input.commandId],
    );
    for (const phase of input.plan.phases)
      await client.query("INSERT INTO goal_plan_phases (goal_id, version, phase_no, title, outcome) VALUES ($1, $2, $3, $4, $5)", [
        input.goalId,
        version,
        phase.phaseNo,
        phase.title,
        phase.outcome,
      ]);
    for (const slice of input.plan.slices)
      await client.query(
        "INSERT INTO goal_plan_slices (goal_id, version, slice_id, phase_no, department_id, title, objective, acceptance, depends_on) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)",
        [input.goalId, version, slice.sliceId, slice.phaseNo, slice.departmentId, slice.title, slice.objective, JSON.stringify(slice.acceptance), JSON.stringify(slice.dependsOn)],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return readLatestGoalPlan(pool, input.goalId, input.projectId);
}

export async function readGoalPlanVersion(pool: Pick<Pool, "query">, goalId: string, projectId: string, version: number): Promise<GoalPlanRecord> {
  const plan = await pool.query<{
    goal_id: string;
    project_id: string;
    version: number;
    status: GoalPlanStatus;
    council_id: string | null;
    content_hash: string;
    approval_ref: string | null;
    created_at: Date;
    updated_at: Date;
  }>("SELECT goal_id, project_id, version, status, council_id, content_hash, approval_ref, created_at, updated_at FROM goal_plans WHERE goal_id = $1 AND project_id = $2 AND version = $3", [
    goalId,
    projectId,
    version,
  ]);
  const row = plan.rows[0];
  if (row === undefined) throw new GoalPlanNotFoundError();
  const phases = await pool.query<{ phase_no: number; title: string; outcome: string }>(
    "SELECT phase_no, title, outcome FROM goal_plan_phases WHERE goal_id = $1 AND version = $2 ORDER BY phase_no",
    [goalId, version],
  );
  const slices = await pool.query<{
    slice_id: string;
    phase_no: number;
    department_id: string;
    title: string;
    objective: string;
    acceptance: string[];
    depends_on: string[];
    status: GoalPlanSliceStatus;
    status_reason: string | null;
  }>(
    "SELECT slice_id, phase_no, department_id, title, objective, acceptance, depends_on, status, status_reason FROM goal_plan_slices WHERE goal_id = $1 AND version = $2 ORDER BY phase_no, (substring(slice_id from 's([0-9]+)$'))::int",
    [goalId, version],
  );
  return {
    goalId: row.goal_id,
    projectId: row.project_id,
    version: Number(row.version),
    status: row.status,
    councilId: row.council_id,
    contentHash: row.content_hash.trim(),
    approvalRef: row.approval_ref,
    phases: phases.rows.map((phase) => ({ phaseNo: Number(phase.phase_no), title: phase.title, outcome: phase.outcome })),
    slices: slices.rows.map((slice) => ({
      sliceId: slice.slice_id,
      phaseNo: Number(slice.phase_no),
      departmentId: slice.department_id,
      title: slice.title,
      objective: slice.objective,
      acceptance: slice.acceptance,
      dependsOn: slice.depends_on,
      status: slice.status,
      statusReason: slice.status_reason,
    })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** The plan to show and act on: the newest approved version, else the newest version. */
export async function readLatestGoalPlan(pool: Pick<Pool, "query">, goalId: string, projectId: string): Promise<GoalPlanRecord> {
  const latest = await pool.query<{ version: number }>(
    "SELECT version FROM goal_plans WHERE goal_id = $1 AND project_id = $2 AND status <> 'superseded' ORDER BY (status = 'approved') DESC, version DESC LIMIT 1",
    [goalId, projectId],
  );
  if (latest.rowCount !== 1) throw new GoalPlanNotFoundError();
  return readGoalPlanVersion(pool, goalId, projectId, Number(latest.rows[0]!.version));
}

/** Move one slice across the board (e.g. when its Worker starts or is certified). */
export async function setGoalPlanSliceStatus(
  pool: Pick<Pool, "query">,
  input: { readonly goalId: string; readonly version: number; readonly sliceId: string; readonly status: GoalPlanSliceStatus; readonly reason?: string },
): Promise<void> {
  const result = await pool.query(
    "UPDATE goal_plan_slices SET status = $4, status_reason = $5, updated_at = transaction_timestamp() WHERE goal_id = $1 AND version = $2 AND slice_id = $3",
    [input.goalId, input.version, input.sliceId, input.status, input.reason ?? null],
  );
  if (result.rowCount !== 1) throw new GoalPlanNotFoundError();
}
