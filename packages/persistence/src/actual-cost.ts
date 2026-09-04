import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";
import type { CouncilActorContext } from "./council.js";

export class ActualCostError extends Error {}

export interface ActualCost {
  readonly costId: string;
  readonly goalId: string;
  readonly commandId: string;
  readonly amountCents: number;
  readonly source: string;
  readonly actorId: string;
  readonly sessionRef: string;
}

/** Records incurred spend, not a reservation or forecast. Retries of one command are idempotent. */
export async function recordActualCost(
  pool: Pool,
  goalId: string,
  amountCents: number,
  source: string,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
): Promise<ActualCost> {
  if (goalId !== proof.goalId || !Number.isSafeInteger(amountCents) || amountCents < 0 || source.trim() === "") {
    throw new ActualCostError("Actual cost has an invalid Goal, amount, or source");
  }
  return withGoalAuthority(pool, proof, 44, async (client) => {
    const inserted = await client.query<{
      cost_id: string; goal_id: string; command_id: string; amount_cents: string; source: string; actor_id: string; session_ref: string;
    }>(
      `INSERT INTO goal_actual_costs (cost_id, goal_id, command_id, amount_cents, source, actor_id, session_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (goal_id, command_id) DO NOTHING
       RETURNING cost_id, goal_id, command_id, amount_cents, source, actor_id, session_ref`,
      [randomUUID(), goalId, context.commandId, amountCents, source.trim(), context.actorId, context.sessionRef],
    );
    if (inserted.rowCount === 1) return map(inserted.rows[0]!);
    const replay = await client.query<{
      cost_id: string; goal_id: string; command_id: string; amount_cents: string; source: string; actor_id: string; session_ref: string;
    }>(
      "SELECT cost_id, goal_id, command_id, amount_cents, source, actor_id, session_ref FROM goal_actual_costs WHERE goal_id = $1 AND command_id = $2 FOR SHARE",
      [goalId, context.commandId],
    );
    if (replay.rowCount !== 1) throw new ActualCostError("Actual cost idempotency record disappeared");
    const row = replay.rows[0]!;
    if (Number(row.amount_cents) !== amountCents || row.source !== source.trim() || row.actor_id !== context.actorId || row.session_ref !== context.sessionRef) {
      throw new ActualCostError("Actual cost command was reused with different content");
    }
    return map(row);
  });
}

export async function listActualCosts(pool: Pool, goalId: string): Promise<readonly ActualCost[]> {
  const result = await pool.query<{
    cost_id: string; goal_id: string; command_id: string; amount_cents: string; source: string; actor_id: string; session_ref: string;
  }>(
    "SELECT cost_id, goal_id, command_id, amount_cents, source, actor_id, session_ref FROM goal_actual_costs WHERE goal_id = $1 ORDER BY recorded_at, cost_id",
    [goalId],
  );
  return result.rows.map(map);
}

function map(row: { cost_id: string; goal_id: string; command_id: string; amount_cents: string; source: string; actor_id: string; session_ref: string }): ActualCost {
  return { costId: row.cost_id, goalId: row.goal_id, commandId: row.command_id, amountCents: Number(row.amount_cents), source: row.source, actorId: row.actor_id, sessionRef: row.session_ref };
}
