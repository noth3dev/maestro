import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen } from "./council.js";

/**
 * Hold the Goal lease and control rows while a Goal-scoped provider effect or
 * durable write runs. The callback must use the supplied client so the lock
 * remains effective until the transaction commits or rolls back.
 */
export async function withGoalAuthority<T>(
  pool: Pool,
  proof: GoalLeaseProof,
  advisoryNamespace: number,
  effect: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) {
    throw new StaleGoalLeaseError(proof.goalId);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lease = await client.query(
      "SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE",
      [proof.goalId, proof.ownerId, proof.fencingToken],
    );
    if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, $2::int))", [proof.goalId, advisoryNamespace]);
    // Report/evidence assembly is valid while a Goal is active or awaiting
    // certification; pause/stop/emergency latches still deny both states.
    await assertGoalControlOpen(client, proof.goalId, ["active", "certifying"]);
    const result = await effect(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
