import type { PoolClient } from "pg";
import { CouncilProtocolError } from "./types.js";

/** A valid lease alone does not authorize Council writes once a Goal is paused, stopping, stopped, or emergency-stopped. */
export async function assertGoalControlOpen(client: PoolClient, goalId: string, allowedStates: readonly string[] = ["active"]): Promise<void> {
  const goalRow = await client.query<{ project_id: string; state: string }>("SELECT project_id, state FROM goals WHERE goal_id = $1 FOR KEY SHARE", [goalId]);
  if (goalRow.rowCount !== 1) throw new CouncilProtocolError("Goal not found for Council authority check");
  const { project_id: projectId, state } = goalRow.rows[0]!;
  if (!allowedStates.includes(state)) throw new CouncilProtocolError(`Goal is ${state}, not an allowed active state; Council writes are denied`);
  // A Goal with no explicit control action yet is implicitly open, matching
  // authority.ts's recheckControl default. Ensure the row exists so the lock
  // below is against durable truth, not an absent row a concurrent writer
  // could still insert.
  await client.query("INSERT INTO goal_controls (project_id, goal_id) VALUES ($1, $2) ON CONFLICT (project_id, goal_id) DO NOTHING", [projectId, goalId]);
  const result = await client.query<{ pause_requested_at: Date | null; paused_at: Date | null; stopping_at: Date | null; stopped_at: Date | null; emergency_stopped_at: Date | null }>(
    "SELECT pause_requested_at, paused_at, stopping_at, stopped_at, emergency_stopped_at FROM goal_controls WHERE project_id = $1 AND goal_id = $2 FOR UPDATE",
    [projectId, goalId],
  );
  if (result.rowCount !== 1) throw new CouncilProtocolError("Goal control state not found for Council authority check");
  const control = result.rows[0]!;
  // Same precedence as authority.ts's recheckControl: terminal/dominant
  // latches first, then a pause request denies writes immediately, matching
  // the documented "pause request denies effects immediately" policy.
  if (control.emergency_stopped_at !== null) throw new CouncilProtocolError("Goal is emergency-stopped; Council writes are denied");
  if (control.stopped_at !== null) throw new CouncilProtocolError("Goal is stopped; Council writes are denied");
  if (control.stopping_at !== null) throw new CouncilProtocolError("Goal is stopping; Council writes are denied");
  if (control.paused_at !== null) throw new CouncilProtocolError("Goal is paused; Council writes are denied");
  if (control.pause_requested_at !== null) throw new CouncilProtocolError("Goal pause is requested; Council writes are denied");
}
