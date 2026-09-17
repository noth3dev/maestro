import { WorkerError, WorkerNotFoundError } from "./types.js";
import { WorkerRow, mapWorker, lockGoalLease } from "./shared.js";
import { randomUUID } from "node:crypto";
import { type Worker } from "@maestro/domain";
import type { Pool } from "pg";
import { StaleGoalLeaseError, type GoalLeaseProof } from "../commands.js";

/**
 * Transfer ownership after a control-plane restart and conservatively fence
 * the invocation. A fresh process has no trustworthy provider session handle,
 * so it records `unknown` rather than attempting resume/reconnect or retry.
 * The unique worker decision makes recovery idempotent and retry-blocking.
 */
export async function recoverWorkerAfterRestart(pool: Pool, workerId: string, proof: GoalLeaseProof, reason: string): Promise<Worker> {
  if (reason.trim() === "") throw new WorkerError("Worker recovery requires a reason");
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const ownerLeaseExpiresAt = await lockGoalLease(client, proof);
    const current = await client.query<WorkerRow & { goal_id: string }>(
      `SELECT w.*, hc.goal_id FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id WHERE w.worker_id = $1 FOR UPDATE`,
      [workerId],
    );
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const row = current.rows[0]!;
    if (row.goal_id !== proof.goalId) throw new StaleGoalLeaseError(proof.goalId);
    if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
      await client.query("COMMIT");
      open = false;
      return mapWorker(row);
    }
    const prior = await client.query("SELECT 1 FROM worker_recovery_decisions WHERE worker_id = $1", [workerId]);
    if (prior.rowCount === 1) {
      await client.query("COMMIT");
      open = false;
      return mapWorker(row);
    }
    const updated = await client.query<WorkerRow>(
      `UPDATE workers
          SET owner_id = $2, owner_fencing_token = $3::bigint, owner_lease_expires_at = $4,
              heartbeat_at = transaction_timestamp(), recovery_state = 'fenced', status = 'unknown',
              repair_hold_expires_at = NULL, repair_approval_id = NULL,
              answer_text = $5, observed_at = transaction_timestamp()
        WHERE worker_id = $1 AND status IN ('spawned', 'running', 'awaiting_repair', 'unknown')
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [workerId, proof.ownerId, proof.fencingToken, ownerLeaseExpiresAt, reason],
    );
    if (updated.rowCount !== 1) throw new WorkerError("Worker recovery raced with another terminal update");
    await client.query(
      `INSERT INTO worker_recovery_decisions (decision_id, worker_id, owner_id, owner_fencing_token, decision, reason)
       VALUES ($1, $2, $3, $4::bigint, 'fenced', $5)`,
      [randomUUID(), workerId, proof.ownerId, proof.fencingToken, reason],
    );
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

/**
 * Provider observation runs outside the database transaction. The second,
 * short transaction rechecks the lease, actor binding, and worker identity
 * before recording the result, so provider latency cannot hold Goal locks.
 */
