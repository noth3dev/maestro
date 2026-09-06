import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen } from "./council.js";

/**
 * Hold the Goal lease and control rows while a Goal-scoped durable database
 * write runs. The callback must use the supplied client so the lock remains
 * effective until the transaction commits or rolls back.
 *
 * This helper is intentionally database-only: callers must not invoke a
 * provider, filesystem, browser, network, or other external effect from the
 * callback. The expiry check immediately before COMMIT is a database fence,
 * not provider-side fencing; external effects require a separate durable
 * reservation/adapter protocol.
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
    // A live lease at transaction start is not sufficient: a slow callback
    // must not commit after its fencing lease has expired. The row lock is
    // already held, so this is a cheap commit-time authority check.
    const stillAuthorized = await client.query(
      "SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp()",
      [proof.goalId, proof.ownerId, proof.fencingToken],
    );
    if (stillAuthorized.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
