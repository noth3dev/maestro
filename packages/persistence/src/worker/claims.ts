import { releaseCapacityForWorker } from "../capacity-reservation.js";
import { WorkerNotFoundError } from "./types.js";
import { WorkerRow, workerSelectSql, withWorkerLease } from "./shared.js";
import { toExecutionRef, toInvocationRef, type ExecutionKernelPort, type ExecutionRef } from "@maestro/domain";
import type { Pool } from "pg";
import { type GoalLeaseProof } from "../commands.js";
import {
  CapabilityApprovalError,
  CapabilityApprovalExpiredError,
  consumeCapabilityApprovals,
  getCapabilityApproval,
  RepetitionBudgetExhaustedError,
} from "../capability-approval.js";

export async function promptWorkerUnderOwnerClaim(
  pool: Pool,
  kernel: ExecutionKernelPort,
  workerId: string,
  execution: ExecutionRef,
  prompt: string,
  proof: GoalLeaseProof,
): Promise<boolean> {
  // Claim and validate the durable owner in a short transaction. Do not hold
  // the worker row lock across provider execution: host effects may need to
  // persist worker-scoped evidence or worktree state, and a held row lock would
  // deadlock their foreign-key writes. The provider receives only the proof
  // captured by this claim; any later durable mutation must recheck it.
  const claimed = await withWorkerLease(pool, workerId, proof, async (_client, worker) => {
    if (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken) return false;
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled" || worker.status === "unknown")
      return false;
    return true;
  });
  if (!claimed) return false;
  await kernel.prompt(execution, prompt);
  return true;
}

export async function expireAwaitingRepairWorker(
  pool: Pool,
  kernel: ExecutionKernelPort,
  workerId: string,
  proof: GoalLeaseProof,
  force = false,
): Promise<boolean> {
  const expired = await withWorkerLease(pool, workerId, proof, async (client, worker) => {
    if (worker.status !== "awaiting_repair") return undefined;
    const updated = await client.query<{ invocation_ref: string }>(
      `UPDATE workers SET status = 'succeeded', repair_hold_expires_at = NULL, repair_approval_id = NULL,
              observed_at = transaction_timestamp(), heartbeat_at = transaction_timestamp()
         WHERE worker_id = $1 AND status = 'awaiting_repair'
           AND ($2::boolean OR repair_hold_expires_at <= clock_timestamp())
         RETURNING invocation_ref`,
      [workerId, force],
    );
    return updated.rowCount === 1 ? updated.rows[0]!.invocation_ref : undefined;
  });
  if (expired !== undefined) {
    await releaseCapacityForWorker(pool, workerId);
    await kernel.release?.(toInvocationRef(expired)).catch(() => {});
    return true;
  }
  return false;
}

export async function expireAwaitingRepairWorkersForGoal(
  pool: Pool,
  kernel: ExecutionKernelPort,
  goalId: string,
  proof: GoalLeaseProof,
): Promise<number> {
  const workers = await pool.query<{ worker_id: string }>(
    `SELECT w.worker_id FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id
      WHERE hc.goal_id = $1 AND w.status = 'awaiting_repair' AND w.repair_hold_expires_at <= clock_timestamp()
      ORDER BY w.worker_id`,
    [goalId],
  );
  let expired = 0;
  for (const row of workers.rows) if (await expireAwaitingRepairWorker(pool, kernel, row.worker_id, proof)) expired += 1;
  return expired;
}

async function consumeRepairBudget(pool: Pool, worker: WorkerRow): Promise<boolean> {
  if (worker.repair_approval_id === null) return false;
  const approval = await getCapabilityApproval(pool, worker.repair_approval_id);
  if (approval === undefined) return false;
  const nextIndex = (
    await pool.query<{ max_effect_index: number | null }>(
      "SELECT max(effect_index)::int AS max_effect_index FROM capability_repetition_claims WHERE approval_id = $1",
      [approval.approvalId],
    )
  ).rows[0]!.max_effect_index;
  const [result] = await consumeCapabilityApprovals(pool, [
    {
      approvalId: approval.approvalId,
      capabilityKind: approval.capabilityKind,
      projectId: approval.projectId,
      goalId: approval.goalId,
      commandId: approval.commandId,
      effectIndex: (nextIndex ?? -1) + 1,
      action: approval.action,
      target: approval.target,
      policyVersion: approval.policyVersion,
      controlEpoch: approval.controlEpoch,
      budgetEffectCents: approval.budgetEffectCents,
    },
  ]);
  return result?.consumed === true;
}

export async function sendWorkerMessageUnderOwnerClaim(
  pool: Pool,
  kernel: ExecutionKernelPort,
  workerId: string,
  message: string,
  proof: GoalLeaseProof,
): Promise<boolean> {
  if (await expireAwaitingRepairWorker(pool, kernel, workerId, proof)) return false;
  const claimed = await withWorkerLease(pool, workerId, proof, async (_client, worker) => {
    if (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken) return undefined;
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled" || worker.status === "unknown")
      return undefined;
    if (worker.execution_ref.startsWith("pending:") || worker.invocation_ref.startsWith("pending:")) return undefined;
    return {
      executionRef: worker.execution_ref,
      invocationRef: worker.invocation_ref,
      ...(worker.status === "awaiting_repair" ? { repairApprovalId: worker.repair_approval_id } : {}),
    };
  });
  if (claimed === undefined) return false;
  if ("repairApprovalId" in claimed) {
    let consumed = false;
    try {
      consumed = claimed.repairApprovalId !== null && (await consumeRepairBudget(pool, await readWorkerRow(pool, workerId)));
    } catch (error) {
      if (
        !(error instanceof CapabilityApprovalError) &&
        !(error instanceof RepetitionBudgetExhaustedError) &&
        !(error instanceof CapabilityApprovalExpiredError)
      )
        throw error;
    }
    if (!consumed) {
      await expireAwaitingRepairWorker(pool, kernel, workerId, proof, true);
      return false;
    }
    const resumed = await withWorkerLease(pool, workerId, proof, async (client, worker) => {
      if (
        worker.status !== "awaiting_repair" ||
        worker.repair_approval_id !== claimed.repairApprovalId ||
        worker.repair_hold_expires_at === null ||
        worker.repair_hold_expires_at <= new Date()
      )
        return undefined;
      const updated = await client.query<{ execution_ref: string; invocation_ref: string }>(
        `UPDATE workers SET status = 'running', repair_hold_expires_at = NULL, repair_approval_id = NULL,
                heartbeat_at = transaction_timestamp(), observed_at = transaction_timestamp()
           WHERE worker_id = $1 AND status = 'awaiting_repair' AND repair_approval_id = $2
         RETURNING execution_ref, invocation_ref`,
        [workerId, claimed.repairApprovalId],
      );
      return updated.rowCount === 1 ? updated.rows[0] : undefined;
    });
    if (resumed === undefined) return false;
    await kernel.sendMessage(toExecutionRef(resumed.execution_ref), toInvocationRef(resumed.invocation_ref), message);
    return true;
  }
  // Use the refs captured under the owner/fence lock. Do not reread a
  // potentially successor-owned row after releasing that lock.
  await kernel.sendMessage(toExecutionRef(claimed.executionRef), toInvocationRef(claimed.invocationRef), message);
  return true;
}

export async function readWorkerRow(pool: Pool, workerId: string): Promise<WorkerRow> {
  const result = await pool.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1", [workerId]);
  if (result.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
  return result.rows[0]!;
}
