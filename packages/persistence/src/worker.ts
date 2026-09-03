import { randomUUID } from "node:crypto";
import {
  assertValidWorkerTransition,
  type ExecutionKernelPort,
  type ExecutionRef,
  type InvocationRef,
  type Worker,
  type WorkerStatus,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "./council.js";
import { readMissionBundle } from "./mission-bundle.js";

export class WorkerError extends Error {}
export class WorkerNotFoundError extends WorkerError {}

export interface SpawnWorkerRequest {
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly itemId: string;
}

interface WorkerRow {
  worker_id: string;
  council_id: string;
  department_id: string;
  plan_version: number;
  item_id: string;
  bundle_content_hash: string;
  attempt: number;
  execution_ref: string;
  invocation_ref: string;
  status: WorkerStatus;
  answer_text: string | null;
  usage_total_tokens: number | null;
}

function mapWorker(row: WorkerRow): Worker {
  return {
    workerId: row.worker_id,
    councilId: row.council_id,
    departmentId: row.department_id,
    planVersion: row.plan_version,
    itemId: row.item_id,
    bundleContentHash: row.bundle_content_hash.trim(),
    attempt: row.attempt,
    executionRef: row.execution_ref,
    invocationRef: row.invocation_ref,
    status: row.status,
    answerText: row.answer_text,
    usageTotalTokens: row.usage_total_tokens,
  };
}

function workerSelectSql(): string {
  return "SELECT worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens FROM workers";
}

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 16))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

/**
 * Spawn one attempt of a worker for a Mission Bundle's assigned mission,
 * through the injected provider-neutral ExecutionKernelPort -- no provider
 * identifier or type crosses this boundary. Only the Department's currently
 * active, captured Head may spawn workers for it (plan/phase2.md: "Only a
 * Department Head may create ordinary workers"). Bounded by the bundle's
 * retryCeiling: attempt N+1 is refused once N+1 exceeds retryCeiling + 1
 * (the ceiling is additional retries beyond the first attempt).
 */
export async function spawnWorker(pool: Pool, kernel: ExecutionKernelPort, request: SpawnWorkerRequest, proof: GoalLeaseProof, context: CouncilActorContext): Promise<Worker> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const council = await readHeadCouncil(pool, request.councilId);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === request.departmentId);
    if (captured === undefined) throw new WorkerError("Department is not a captured Council participant");
    const authorized = captured.headRoleId !== undefined
      ? isAuthorizedHeadCouncilActor(context, captured)
      : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
    if (!authorized) throw new WorkerError("Worker spawn actor is not bound to the captured Head identity and session");
    const active = await client.query(
      "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3 FOR UPDATE",
      [council.goalId, request.departmentId, captured.sessionRef],
    );
    if (active.rowCount !== 1) throw new WorkerError("Captured Head session is no longer authorized to spawn workers");
    const bundle = await readMissionBundle(pool, request.councilId, request.departmentId, request.planVersion, request.itemId);
    const priorAttempts = await client.query<{ attempt: number; status: WorkerStatus }>(
      "SELECT attempt, status FROM workers WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4 ORDER BY attempt DESC FOR UPDATE",
      [request.councilId, request.departmentId, request.planVersion, request.itemId],
    );
    const activeAttempt = priorAttempts.rows.find((row) => row.status === "spawned" || row.status === "running");
    if (activeAttempt !== undefined) throw new WorkerError(`A worker is already active for this mission (attempt ${activeAttempt.attempt})`);
    const nextAttempt = (priorAttempts.rows[0]?.attempt ?? 0) + 1;
    if (nextAttempt > bundle.substance.retryCeiling + 1) throw new WorkerError(`Mission retry ceiling exceeded: ${bundle.substance.retryCeiling}`);
    const spawned = await kernel.spawn({
      name: `${bundle.substance.role}:${request.itemId}:${nextAttempt}`,
      prompt: bundle.substance.goalBrief,
      // Every field is the exact least-privilege grant this Mission Bundle
      // declared -- never widened, never inferred (Phase 2 re-patch item 2:
      // this scoping previously never reached the real spawn call at all).
      capabilities: { allowedTools: bundle.substance.allowedTools, allowedSkills: bundle.substance.allowedSkills },
    });
    const workerId = randomUUID();
    const inserted = await client.query<WorkerRow>(
      `INSERT INTO workers (worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'spawned')
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
      [workerId, request.councilId, request.departmentId, request.planVersion, request.itemId, bundle.contentHash, nextAttempt, spawned.execution, spawned.invocation],
    );
    await client.query("COMMIT"); open = false;
    return mapWorker(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function readWorker(pool: Pool, workerId: string): Promise<Worker> {
  const result = await pool.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1", [workerId]);
  if (result.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
  return mapWorker(result.rows[0]!);
}

export async function listWorkersForMission(pool: Pool, councilId: string, departmentId: string, planVersion: number, itemId: string): Promise<readonly Worker[]> {
  const result = await pool.query<WorkerRow>(workerSelectSql() + " WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4 ORDER BY attempt", [councilId, departmentId, planVersion, itemId]);
  return result.rows.map(mapWorker);
}

/**
 * Observe the current state of a worker through the execution kernel and
 * durably record status/answer/usage. A terminal status is written once and
 * is then immutable (both application-checked and DB-trigger-enforced); a
 * repeated observation of the same terminal outcome is a safe no-op.
 */
export async function observeWorker(pool: Pool, kernel: ExecutionKernelPort, workerId: string): Promise<Worker> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const current = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const worker = current.rows[0]!;
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled") {
      await client.query("COMMIT"); open = false;
      return mapWorker(worker);
    }
    const observations = await kernel.observe(worker.execution_ref as unknown as ExecutionRef);
    const observation = observations.find((candidate) => candidate.invocation === worker.invocation_ref);
    const nextStatus: WorkerStatus = observation === undefined ? "unknown" : observation.status === "queued" ? "spawned" : observation.status;
    assertValidWorkerTransition(worker.status, nextStatus);
    const answerText = observation?.answer.state === "available" ? observation.answer.text : worker.answer_text;
    const usage = observation?.usage.state === "available" ? observation.usage.totalTokens : worker.usage_total_tokens;
    const updated = await client.query<WorkerRow>(
      `UPDATE workers SET status = $2, answer_text = $3, usage_total_tokens = $4, observed_at = transaction_timestamp()
       WHERE worker_id = $1
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
      [workerId, nextStatus, answerText, usage],
    );
    await client.query("COMMIT"); open = false;
    const result = mapWorker(updated.rows[0]!);
    // Only now that the terminal status is durably committed may the kernel
    // forget its in-process record (Phase 1 re-patch item 2); a nonterminal
    // status must keep it, since the next observeWorker call still needs it.
    if (result.status === "succeeded" || result.status === "failed" || result.status === "cancelled") {
      // Best-effort only: this is durable-evidence-write cleanup, not part of
      // the durable write itself (already committed above), so a release
      // failure must never surface as if the observation itself failed.
      await kernel.release?.(worker.invocation_ref as unknown as InvocationRef).catch(() => {});
    }
    return result;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Only the captured, currently active Head that owns this mission may cancel its worker. */
export async function cancelWorker(pool: Pool, kernel: ExecutionKernelPort, workerId: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<Worker> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const current = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const worker = current.rows[0]!;
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled") {
      await client.query("COMMIT"); open = false;
      return mapWorker(worker);
    }
    const council = await readHeadCouncil(pool, worker.council_id);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === worker.department_id);
    if (captured === undefined) throw new WorkerError("Department is not a captured Council participant");
    const authorized = captured.headRoleId !== undefined
      ? isAuthorizedHeadCouncilActor(context, captured)
      : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
    if (!authorized) throw new WorkerError("Worker cancellation actor is not bound to the captured Head identity and session");
    await kernel.cancel(worker.invocation_ref as unknown as InvocationRef);
    const updated = await client.query<WorkerRow>(
      `UPDATE workers SET status = 'cancelled', observed_at = transaction_timestamp()
       WHERE worker_id = $1
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
      [workerId],
    );
    await client.query("COMMIT"); open = false;
    // Cancellation is terminal and now durably committed; release the
    // kernel's in-process record for this invocation (Phase 1 item 2).
    // Best-effort: a release failure must never surface as a cancellation
    // failure, since the durable cancellation already committed above.
    await kernel.release?.(worker.invocation_ref as unknown as InvocationRef).catch(() => {});
    return mapWorker(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
