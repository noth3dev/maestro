import type { GoalHeadParticipation } from "@maestro/domain";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "../commands.js";
import { assertGoalControlOpen } from "../council.js";
import type { PoolClient } from "pg";
import type { ParticipationRow } from "./types.js";

export type { ParticipationRow };

export function mapParticipation(row: ParticipationRow): GoalHeadParticipation {
  return {
    goalId: row.goal_id,
    departmentId: row.department_id,
    headRoleId: row.head_role_id,
    contractId: row.contract_id,
    contextId: row.context_id,
    status: row.status,
    activeSessionRef: row.active_session_ref,
  };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validProof(proof: GoalLeaseProof): boolean {
  return proof.goalId !== "" && proof.ownerId !== "" && isValidFencingToken(proof.fencingToken);
}

export async function assertGoalLeaseOwnership(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const result = await client.query(
    `SELECT goal_id FROM goal_leases
     WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint
       AND expires_at > transaction_timestamp()
     FOR UPDATE`,
    [proof.goalId, proof.ownerId, proof.fencingToken],
  );
  if (result.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
}

export async function assertCurrentGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const result = await client.query(
    `SELECT goal_id FROM goal_leases
     WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint
       AND expires_at > transaction_timestamp()
     FOR UPDATE`,
    [proof.goalId, proof.ownerId, proof.fencingToken],
  );
  if (result.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  // A valid lease alone does not authorize Head participation writes once the
  // Goal is paused, stopping, stopped, or emergency-stopped -- matches the
  // Council/DepartmentPlan/Worker call sites' existing control-latch check.
  await assertGoalControlOpen(client, proof.goalId);
}
