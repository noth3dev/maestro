import { releaseCapacityForWorker } from "../capacity-reservation.js";
import { WorkerError } from "./types.js";
import { WorkerRow, mapWorker, withWorkerLease } from "./shared.js";
import { type ExecutionKernelPort, type InvocationRef, type Worker } from "@maestro/domain";
import type { Pool } from "pg";
import { StaleGoalLeaseError, type GoalLeaseProof } from "../commands.js";

export async function markUnboundWorkerUnknown(pool: Pool, workerId: string, proof: GoalLeaseProof): Promise<Worker | undefined> {
  return withWorkerLease(pool, workerId, proof, async (client) => {
    const result = await client.query<WorkerRow>(
      `UPDATE workers SET status = 'unknown', observed_at = transaction_timestamp(), answer_text = $2
        WHERE worker_id = $1 AND status = 'spawned' AND execution_ref LIKE 'pending:%' AND invocation_ref LIKE 'pending:%'
          AND owner_id = $3 AND owner_fencing_token = $4::bigint
        RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [workerId, "Provider spawn outcome is unknown; reconciliation is required", proof.ownerId, proof.fencingToken],
    );
    return result.rowCount === 1 ? mapWorker(result.rows[0]!) : undefined;
  });
}

export async function markWorkerTerminal(
  pool: Pool,
  workerId: string,
  status: "cancelled" | "failed",
  proof: GoalLeaseProof,
): Promise<void> {
  await withWorkerLease(pool, workerId, proof, async (client) => {
    await client.query(
      "UPDATE workers SET status = $2, recovery_state = CASE WHEN $2 = 'cancelled' THEN 'provider_cancelled' ELSE recovery_state END, observed_at = transaction_timestamp() WHERE worker_id = $1 AND status IN ('spawned', 'unknown', 'running') AND owner_id = $3 AND owner_fencing_token = $4::bigint",
      [workerId, status, proof.ownerId, proof.fencingToken],
    );
  });
  await releaseCapacityForWorker(pool, workerId);
}

export async function markWorkerUnknown(pool: Pool, workerId: string, proof: GoalLeaseProof): Promise<void> {
  await withWorkerLease(pool, workerId, proof, async (client) => {
    await client.query(
      "UPDATE workers SET status = 'unknown', observed_at = transaction_timestamp() WHERE worker_id = $1 AND status IN ('spawned', 'running') AND owner_id = $2 AND owner_fencing_token = $3::bigint",
      [workerId, proof.ownerId, proof.fencingToken],
    );
  });
}

/** Compensate a provider spawn only while the original owner claim is held.
 * A stale owner leaves the pending reservation for successor reconciliation. */
export async function cancelUnboundWorkerAfterBindingFailure(
  pool: Pool,
  kernel: ExecutionKernelPort,
  workerId: string,
  invocation: InvocationRef,
  proof: GoalLeaseProof,
): Promise<boolean> {
  const cancelled = await withWorkerLease(pool, workerId, proof, async (client, worker) => {
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled") return true;
    if (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken)
      throw new WorkerError("Worker owner proof is stale or fenced");
    if (!worker.execution_ref.startsWith("pending:") || !worker.invocation_ref.startsWith("pending:"))
      throw new WorkerError("Worker provider binding was already completed");
    const cancellation = await kernel.cancel(invocation);
    const status = cancellation.cancelled ? "cancelled" : "unknown";
    await client.query(
      `UPDATE workers
          SET status = $2, recovery_state = CASE WHEN $2 = 'cancelled' THEN 'provider_cancelled' ELSE recovery_state END,
              answer_text = CASE WHEN $2 = 'unknown' THEN $3 ELSE answer_text END,
              observed_at = transaction_timestamp(), heartbeat_at = transaction_timestamp()
        WHERE worker_id = $1 AND status IN ('spawned', 'running', 'unknown')
          AND owner_id = $4 AND owner_fencing_token = $5::bigint
          AND execution_ref LIKE 'pending:%' AND invocation_ref LIKE 'pending:%'`,
      [
        workerId,
        status,
        "Provider binding compensation could not confirm cancellation; reconciliation is required",
        proof.ownerId,
        proof.fencingToken,
      ],
    );
    return cancellation.cancelled;
  });
  return cancelled;
}

export async function bindWorkerInvocation(
  pool: Pool,
  workerId: string,
  spawned: import("@maestro/domain").SpawnedInvocation,
  proof: GoalLeaseProof,
): Promise<Worker> {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    // Provider identity binding is immutable bookkeeping, not a provider effect.
    // Lock only the worker row so it remains safe after Goal ownership turns
    // over: the successor must still receive the refs returned by this spawn.
    const worker = await client.query<{ goal_id: string }>(
      "SELECT hc.goal_id FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id WHERE w.worker_id = $1 FOR UPDATE",
      [workerId],
    );
    if (worker.rowCount !== 1 || worker.rows[0]!.goal_id !== proof.goalId) throw new StaleGoalLeaseError(proof.goalId);
    const updated = await client.query<WorkerRow>(
      `UPDATE workers
          SET execution_ref = $2, invocation_ref = $3
        WHERE worker_id = $1 AND execution_ref LIKE 'pending:%' AND invocation_ref LIKE 'pending:%'
          AND status IN ('spawned', 'running', 'unknown')
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [workerId, spawned.execution, spawned.invocation],
    );
    if (updated.rowCount !== 1) throw new WorkerError("Worker provider binding was already completed or is missing");
    await client.query("COMMIT");
    open = false;
    return mapWorker(updated.rows[0]!);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
