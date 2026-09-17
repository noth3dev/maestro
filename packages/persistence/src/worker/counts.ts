import { WorkerRow, mapWorker, workerSelectWithGoalSql } from "./shared.js";
import { type Worker } from "@maestro/domain";
import type { Pool } from "pg";

export async function listWorkersForGoal(pool: Pool, goalId: string): Promise<readonly Worker[]> {
  const result = await pool.query<WorkerRow>(
    workerSelectWithGoalSql() + " WHERE hc.goal_id = $1 ORDER BY w.council_id, w.department_id, w.plan_version, w.item_id, w.attempt",
    [goalId],
  );
  return result.rows.map(mapWorker);
}

/**
 * Counts workers currently occupying a worker slot (spawned or running -- not yet terminal) for
 * a project, across every Goal in it. This is Phase 5's first real capacity-model primitive
 * (roadmap/act-1-foundation/phase-05-concurrent-goals-portfolio.md "Capacity model": "worker slots by risk class" simplified to one project-wide
 * slot count for this initial slice; risk-class partitioning is a later refinement, not
 * implemented here).
 */
export async function countActiveWorkersForProject(pool: Pool, projectId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::bigint AS count
       FROM workers w
       JOIN head_councils hc ON hc.council_id = w.council_id
       JOIN goals g ON g.goal_id = hc.goal_id
      WHERE g.project_id = $1 AND w.status IN ('spawned', 'running', 'awaiting_repair')`,
    [projectId],
  );
  return Number(result.rows[0]!.count);
}
