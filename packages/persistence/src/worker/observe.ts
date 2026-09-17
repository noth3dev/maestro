import { releaseCapacityForWorker } from "../capacity-reservation.js";
import {
  WorkerRow,
  ensureRepairApproval,
  mapWorker,
  workerSelectSql,
  lockGoalLease,
  withWorkerLease,
  assertWorkerAuthorization,
} from "./shared.js";
import {
  assertValidWorkerTransition,
  toExecutionRef,
  toInvocationRef,
  type ExecutionKernelPort,
  type Worker,
  type WorkerStatus,
} from "@maestro/domain";
import type { Pool } from "pg";
import { StaleGoalLeaseError, type GoalLeaseProof } from "../commands.js";
import { type CouncilActorContext } from "../council.js";
import { readMissionBundle } from "../mission-bundle.js";
import { getCapabilityApproval } from "../capability-approval.js";
import { readWorker } from "./reads.js";
import { expireAwaitingRepairWorker, readWorkerRow } from "./claims.js";
import { missionTimeLimitMs } from "./model.js";
import { WorkerError, WorkerNotFoundError } from "./types.js";

/**
 * Observe the current state of a worker through the execution kernel and
 * durably record status/answer/usage. A terminal status is written once and
 * is then immutable (both application-checked and DB-trigger-enforced); a
 * repeated observation of the same terminal outcome is a safe no-op.
 */
export async function observeWorker(
  pool: Pool,
  kernel: ExecutionKernelPort,
  workerId: string,
  proof: GoalLeaseProof,
  context?: CouncilActorContext,
): Promise<Worker> {
  const initial = await readWorker(pool, workerId);
  const initialRow = await readWorkerRow(pool, workerId);
  if (initial.status === "awaiting_repair") {
    await expireAwaitingRepairWorker(pool, kernel, workerId, proof);
    return readWorker(pool, workerId);
  }
  if (initial.status === "succeeded" || initial.status === "failed" || initial.status === "cancelled") return initial;
  const observations = await kernel.observe(toExecutionRef(initial.executionRef));
  const observation = observations.find((candidate) => candidate.invocation === initial.invocationRef);
  let nextStatus: WorkerStatus = observation === undefined ? "unknown" : observation.status === "queued" ? "spawned" : observation.status;
  const answerText = observation?.answer.state === "available" ? observation.answer.text : initial.answerText;
  const usage = observation?.usage.state === "available" ? observation.usage.totalTokens : initial.usageTotalTokens;
  let repairHoldDurationMs: number | undefined;
  let repairApprovalId: string | undefined;
  if (nextStatus === "succeeded") {
    const bundle = await readMissionBundle(
      pool,
      initialRow.council_id,
      initialRow.department_id,
      initialRow.plan_version,
      initialRow.item_id,
    );
    if (bundle.substance.repairHold !== undefined) {
      repairHoldDurationMs = missionTimeLimitMs(bundle.substance.repairHold.window);
      const holdExpiresAt = new Date(Date.now() + repairHoldDurationMs);
      const approval = await ensureRepairApproval(pool, initialRow, proof.goalId, bundle.substance.repairHold, holdExpiresAt);
      const budget = await getCapabilityApproval(pool, approval.approvalId);
      const budgetExpired =
        budget?.repetitionExpiresAt !== null && budget?.repetitionExpiresAt !== undefined && budget.repetitionExpiresAt <= new Date();
      if (budget === undefined || budget.repetitionRemainingCount === 0 || budgetExpired) {
        repairHoldDurationMs = undefined;
      } else {
        repairApprovalId = approval.approvalId;
        nextStatus = "awaiting_repair";
      }
    }
  }

  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const goal = await client.query<{ goal_id: string }>(
      "SELECT hc.goal_id FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id WHERE w.worker_id = $1",
      [workerId],
    );
    if (goal.rowCount !== 1 || goal.rows[0]!.goal_id !== proof.goalId) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const current = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const row = current.rows[0]!;
    if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
      await client.query("COMMIT");
      open = false;
      return mapWorker(row);
    }
    await assertWorkerAuthorization(pool, client, row, proof, context);
    // A provider response captured for a replaced binding must never overwrite
    // the new owner. Binding is immutable, but this check also documents the
    // optimistic identity fence for future reconciliation code.
    if (row.execution_ref !== initial.executionRef || row.invocation_ref !== initial.invocationRef) {
      await client.query("COMMIT");
      open = false;
      return mapWorker(row);
    }
    assertValidWorkerTransition(row.status, nextStatus);
    const updated = await client.query<WorkerRow>(
      `UPDATE workers SET status = $2, answer_text = $3, usage_total_tokens = $4, observed_at = transaction_timestamp(), heartbeat_at = transaction_timestamp(),
              repair_hold_expires_at = CASE WHEN $10::boolean THEN transaction_timestamp() + ($11::double precision * interval '1 millisecond') ELSE NULL END,
              repair_approval_id = CASE WHEN $10::boolean THEN $12::uuid ELSE NULL END,
              owner_lease_expires_at = COALESCE((SELECT expires_at FROM goal_leases WHERE goal_id = NULLIF($7, '')::uuid AND owner_id = $8 AND fencing_token = $9::bigint), owner_lease_expires_at)
       WHERE worker_id = $1 AND execution_ref = $5 AND invocation_ref = $6
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens, repair_hold_expires_at, repair_approval_id`,
      [
        workerId,
        nextStatus,
        answerText,
        usage,
        initial.executionRef,
        initial.invocationRef,
        proof?.goalId ?? "",
        proof?.ownerId ?? "",
        proof?.fencingToken ?? "0",
        repairHoldDurationMs !== undefined,
        repairHoldDurationMs ?? 0,
        repairApprovalId ?? null,
      ],
    );
    await client.query("COMMIT");
    open = false;
    const result = mapWorker(updated.rows[0] ?? row);
    if (result.status === "succeeded" || result.status === "failed" || result.status === "cancelled")
      await releaseCapacityForWorker(pool, workerId);
    if (result.status === "succeeded" || result.status === "failed" || result.status === "cancelled")
      await kernel.release?.(toInvocationRef(result.invocationRef)).catch(() => {});
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Only the captured, currently active Head that owns this mission may cancel its worker. */
export async function cancelWorker(
  pool: Pool,
  kernel: ExecutionKernelPort,
  workerId: string,
  proof: GoalLeaseProof,
  context: CouncilActorContext,
): Promise<Worker> {
  const initial = await readWorker(pool, workerId);
  if (initial.status === "succeeded" || initial.status === "failed" || initial.status === "cancelled") return initial;

  // Intent authorization commits first. The provider cancellation itself then
  // runs under a second serialized Goal/worker owner claim.
  const authorize = async (workerIdToAuthorize: string): Promise<boolean> => {
    return withWorkerLease(pool, workerIdToAuthorize, proof, async (client, worker) => {
      if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled") return false;
      await assertWorkerAuthorization(pool, client, worker, proof, context);
      // Phase 5 cancellation is two-phase: record intent and owner proof
      // before touching the provider. A crash after this point is visible to
      // recovery and cannot be mistaken for an unrequested cancellation.
      await client.query(
        `UPDATE workers
            SET owner_id = COALESCE(owner_id, $2), owner_fencing_token = COALESCE(owner_fencing_token, $3::bigint),
                cancellation_requested_at = COALESCE(cancellation_requested_at, transaction_timestamp()),
                cancellation_owner_id = $2, cancellation_fencing_token = $3::bigint,
                heartbeat_at = transaction_timestamp(),
                owner_lease_expires_at = COALESCE((SELECT expires_at FROM goal_leases WHERE goal_id = $4 AND owner_id = $2 AND fencing_token = $3::bigint), owner_lease_expires_at)
          WHERE worker_id = $1 AND status IN ('spawned', 'running', 'unknown')`,
        [workerIdToAuthorize, proof.ownerId, proof.fencingToken, proof.goalId],
      );
      return true;
    });
  };
  if (!(await authorize(workerId))) return readWorker(pool, workerId);

  // Keep the Goal lease and worker row locked while the provider receives the
  // cancellation. A successor cannot replace this owner until the effect has
  // returned, eliminating the stale-owner cancellation TOCTOU window at this
  // provider boundary.
  const cancellation = await withWorkerLease(pool, workerId, proof, async (client, worker) => {
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled") {
      return { terminal: true as const, cancelled: false };
    }
    if (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken)
      throw new WorkerError("Worker owner proof is stale or fenced");
    await assertWorkerAuthorization(pool, client, worker, proof, context);
    return { terminal: false as const, cancelled: (await kernel.cancel(toInvocationRef(initial.invocationRef))).cancelled };
  });
  if (cancellation.terminal) return readWorker(pool, workerId);

  let nextStatus: WorkerStatus = "cancelled";
  let answerText = initial.answerText;
  let usage = initial.usageTotalTokens;
  if (!cancellation.cancelled) {
    const observations = await kernel.observe(toExecutionRef(initial.executionRef));
    const observation = observations.find((candidate) => candidate.invocation === initial.invocationRef);
    nextStatus = observation === undefined ? "unknown" : observation.status === "queued" ? "spawned" : observation.status;
    answerText = observation?.answer.state === "available" ? observation.answer.text : answerText;
    usage = observation?.usage.state === "available" ? observation.usage.totalTokens : usage;
  }

  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const goal = await client.query<{ goal_id: string }>(
      "SELECT hc.goal_id FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id WHERE w.worker_id = $1",
      [workerId],
    );
    if (goal.rowCount !== 1 || goal.rows[0]!.goal_id !== proof.goalId) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const current = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const row = current.rows[0]!;
    if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
      await client.query("COMMIT");
      open = false;
      return mapWorker(row);
    }
    await assertWorkerAuthorization(pool, client, row, proof, context);
    if (row.execution_ref !== initial.executionRef || row.invocation_ref !== initial.invocationRef) {
      await client.query("COMMIT");
      open = false;
      return mapWorker(row);
    }
    assertValidWorkerTransition(row.status, nextStatus);
    const updated = await client.query<WorkerRow>(
      `UPDATE workers SET status = $2, answer_text = $3, usage_total_tokens = $4, observed_at = transaction_timestamp(), heartbeat_at = transaction_timestamp(), owner_lease_expires_at = COALESCE((SELECT expires_at FROM goal_leases WHERE goal_id = NULLIF($7, '')::uuid AND owner_id = $8 AND fencing_token = $9::bigint), owner_lease_expires_at)
       WHERE worker_id = $1 AND execution_ref = $5 AND invocation_ref = $6
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [
        workerId,
        nextStatus,
        answerText,
        usage,
        initial.executionRef,
        initial.invocationRef,
        proof.goalId,
        proof.ownerId,
        proof.fencingToken,
      ],
    );
    await client.query("COMMIT");
    open = false;
    const result = mapWorker(updated.rows[0] ?? row);
    if (nextStatus === "succeeded" || nextStatus === "failed" || nextStatus === "cancelled") await releaseCapacityForWorker(pool, workerId);
    if (nextStatus === "succeeded" || nextStatus === "failed" || nextStatus === "cancelled")
      await kernel.release?.(toInvocationRef(result.invocationRef)).catch(() => {});
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lists every worker whose Head Council is bound to the given Goal, for a project-scoped Goal
 * "roster/pipeline" read view. Read-only; requires no lease/authority proof for the same reason
 * as `getGoalGitIntegrationState` -- it exposes only already-durable per-worker state a project
 * member could already read one worker at a time via `readWorker`.
 */
