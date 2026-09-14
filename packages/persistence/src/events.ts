import type { GoalEvent } from "@maestro/contracts";
import type { Pool } from "pg";

export const EVENT_PAGE_LIMIT = 100;

/** Replay truth is goal_events, never the delivery-oriented outbox. */
export async function listGoalEvents(
  pool: Pool,
  { projectId, after }: { projectId: string; after: string },
): Promise<GoalEvent[]> {
  const result = await pool.query<GoalEventRow>(
    `SELECT global_position, event_id, project_id, goal_id, aggregate_version,
            event_type, schema_version, payload, occurred_at
       FROM goal_events
      WHERE project_id = $1 AND global_position > $2::bigint
      ORDER BY global_position ASC
      LIMIT ${EVENT_PAGE_LIMIT}`,
    [projectId, after],
  );
  return result.rows.map(toGoalEvent);
}

interface GoalEventRow {
  global_position: string;
  event_id: string;
  project_id: string;
  goal_id: string;
  aggregate_version: string;
  event_type: string;
  schema_version: number;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

function toGoalEvent(row: GoalEventRow): GoalEvent {
  return {
    cursor: row.global_position,
    eventId: row.event_id,
    projectId: row.project_id,
    goalId: row.goal_id,
    aggregateVersion: row.aggregate_version,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    payload: row.payload,
    occurredAt: row.occurred_at.toISOString(),
  };
}
