import { createHash, randomUUID } from "node:crypto";
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
  /** Stable API command identity for replay-safe worker creation. */
  readonly commandId?: string;
  readonly itemId: string;
  /** Validated owned worktree directory supplied by the orchestration layer. */
  readonly cwd?: string;
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
    const requestHash = request.commandId === undefined ? undefined : createHash("sha256").update(JSON.stringify({
      councilId: request.councilId, departmentId: request.departmentId, planVersion: request.planVersion,
      itemId: request.itemId, bundleContentHash: bundle.contentHash,
    })).digest("hex");
    if (request.commandId !== undefined) {
      const priorCommand = await client.query<{ worker_id: string; spawn_request_hash: string | null }>(
        `SELECT worker_id, spawn_request_hash FROM workers WHERE spawn_command_id = $1 FOR UPDATE`, [request.commandId],
      );
      if (priorCommand.rowCount === 1) {
        const prior = priorCommand.rows[0]!;
        if (prior.spawn_request_hash?.trim() !== requestHash) throw new WorkerError("Worker command identity was reused with different content");
        const replay = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1", [prior.worker_id]);
        if (replay.rowCount !== 1) throw new WorkerError("Worker command replay could not be resolved");
        await client.query("COMMIT"); open = false;
        return mapWorker(replay.rows[0]!);
      }
    }
    const priorAttempts = await client.query<{ attempt: number; status: WorkerStatus }>(
      "SELECT attempt, status FROM workers WHERE council_id = $1 AND department_id = $2 AND plan_version = $3 AND item_id = $4 ORDER BY attempt DESC FOR UPDATE",
      [request.councilId, request.departmentId, request.planVersion, request.itemId],
    );
    const activeAttempt = priorAttempts.rows.find((row) => row.status === "spawned" || row.status === "running");
    if (activeAttempt !== undefined) throw new WorkerError(`A worker is already active for this mission (attempt ${activeAttempt.attempt})`);
    const unknownAttempt = priorAttempts.rows.find((row) => row.status === "unknown");
    if (unknownAttempt !== undefined) throw new WorkerError(`Worker provider state is unknown for this mission (attempt ${unknownAttempt.attempt}); reconcile before retrying`);
    const nextAttempt = (priorAttempts.rows[0]?.attempt ?? 0) + 1;
    if (nextAttempt > bundle.substance.retryCeiling + 1) throw new WorkerError(`Mission retry ceiling exceeded: ${bundle.substance.retryCeiling}`);
    // Reserve the worker identity before contacting the provider. A crash or
    // provider failure is therefore visible to replay/reconciliation instead
    // of being an unowned external session.
    const workerId = randomUUID();
    const pendingExecution = `pending:${workerId}`;
    const inserted = await client.query<WorkerRow>(
      `INSERT INTO workers (worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, spawn_command_id, spawn_request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'spawned', $10, $11)
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
      [workerId, request.councilId, request.departmentId, request.planVersion, request.itemId, bundle.contentHash, nextAttempt, pendingExecution, pendingExecution, request.commandId ?? null, requestHash ?? null],
    );
    await client.query("COMMIT"); open = false;
    let spawned: import("@maestro/domain").SpawnedInvocation;
    try {
      spawned = await kernel.spawn({
        name: `${bundle.substance.role}:${request.itemId}:${nextAttempt}`,
        prompt: bundle.substance.goalBrief,
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        // Every field is the exact least-privilege grant this Mission Bundle
        // declared -- never widened, never inferred.
        capabilities: { allowedTools: bundle.substance.allowedTools, allowedSkills: bundle.substance.allowedSkills },
      });
    } catch {
      // A transport timeout does not prove that the provider created nothing.
      // Keep the durable reservation ambiguous and block automatic retries
      // until reconciliation can establish the provider outcome.
      const unknown = await markUnboundWorkerUnknown(pool, workerId).catch(() => undefined);
      return unknown ?? mapWorker(inserted.rows[0]!);
    }
    let boundWorker: Worker;
    try {
      boundWorker = await bindWorkerInvocation(pool, workerId, spawned, proof);
    } catch (error) {
      const cancellation = await kernel.cancel(spawned.invocation).catch(() => ({ cancelled: false }));
      if (cancellation.cancelled) await markWorkerTerminal(pool, workerId, "cancelled").catch(() => {});
      else await markWorkerUnknown(pool, workerId).catch(() => {});
      throw error;
    }
    try {
      await kernel.prompt(spawned.execution, bundle.substance.goalBrief);
    } catch {
      try { return await observeWorker(pool, kernel, workerId, proof, context); } catch { return boundWorker; }
    }
    return boundWorker;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function markUnboundWorkerUnknown(pool: Pool, workerId: string): Promise<Worker | undefined> {
  const result = await pool.query<WorkerRow>(
    `UPDATE workers SET status = 'unknown', observed_at = transaction_timestamp(), answer_text = $2
      WHERE worker_id = $1 AND status = 'spawned' AND execution_ref LIKE 'pending:%' AND invocation_ref LIKE 'pending:%'
      RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
    [workerId, "Provider spawn outcome is unknown; reconciliation is required"],
  );
  return result.rowCount === 1 ? mapWorker(result.rows[0]!) : undefined;
}

async function markWorkerTerminal(pool: Pool, workerId: string, status: "cancelled" | "failed"): Promise<void> {
  await pool.query("UPDATE workers SET status = $2, observed_at = transaction_timestamp() WHERE worker_id = $1 AND status IN ('spawned', 'unknown', 'running')", [workerId, status]);
}

async function markWorkerUnknown(pool: Pool, workerId: string): Promise<void> {
  await pool.query("UPDATE workers SET status = 'unknown', observed_at = transaction_timestamp() WHERE worker_id = $1 AND status IN ('spawned', 'running')", [workerId]);
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
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    // Binding is durable ownership bookkeeping, not a new external effect. It
    // must still complete after lease turnover so the spawned provider session
    // remains attributable to its reserved worker.
    const updated = await client.query<WorkerRow>(
      `UPDATE workers
          SET execution_ref = $2, invocation_ref = $3
        WHERE worker_id = $1 AND execution_ref LIKE 'pending:%' AND invocation_ref LIKE 'pending:%'
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
      [workerId, spawned.execution, spawned.invocation],
    );
    if (updated.rowCount !== 1) throw new WorkerError("Worker provider binding was already completed or is missing");
    await client.query("COMMIT"); open = false;
    return mapWorker(updated.rows[0]!);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
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
async function assertWorkerAuthorization(
  pool: Pool,
  client: PoolClient,
  worker: WorkerRow,
  proof?: GoalLeaseProof,
  context?: CouncilActorContext,
): Promise<void> {
  if (proof !== undefined) {
    const council = await readHeadCouncil(pool, worker.council_id);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    if (context !== undefined) {
      const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === worker.department_id);
      if (captured === undefined || captured.headRoleId === undefined || !isAuthorizedHeadCouncilActor(context, captured)) throw new WorkerError("Worker actor is not bound to the captured Head identity and session");
      const active = await client.query(
        "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3 FOR UPDATE",
        [council.goalId, worker.department_id, captured.sessionRef],
      );
      if (active.rowCount !== 1) throw new WorkerError("Captured Head session is no longer authorized for this worker");
    }
  }
}

/**
 * Provider observation runs outside the database transaction. The second,
 * short transaction rechecks the lease, actor binding, and worker identity
 * before recording the result, so provider latency cannot hold Goal locks.
 */
export async function observeWorker(pool: Pool, kernel: ExecutionKernelPort, workerId: string, proof?: GoalLeaseProof, context?: CouncilActorContext): Promise<Worker> {
  const initial = await readWorker(pool, workerId);
  if (initial.status === "succeeded" || initial.status === "failed" || initial.status === "cancelled") return initial;
  const observations = await kernel.observe(initial.executionRef as unknown as ExecutionRef);
  const observation = observations.find((candidate) => candidate.invocation === initial.invocationRef);
  const nextStatus: WorkerStatus = observation === undefined ? "unknown" : observation.status === "queued" ? "spawned" : observation.status;
  const answerText = observation?.answer.state === "available" ? observation.answer.text : initial.answerText;
  const usage = observation?.usage.state === "available" ? observation.usage.totalTokens : initial.usageTotalTokens;

  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const current = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const row = current.rows[0]!;
    if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
      await client.query("COMMIT"); open = false;
      return mapWorker(row);
    }
    await assertWorkerAuthorization(pool, client, row, proof, context);
    // A provider response captured for a replaced binding must never overwrite
    // the new owner. Binding is immutable, but this check also documents the
    // optimistic identity fence for future reconciliation code.
    if (row.execution_ref !== initial.executionRef || row.invocation_ref !== initial.invocationRef) {
      await client.query("COMMIT"); open = false;
      return mapWorker(row);
    }
    assertValidWorkerTransition(row.status, nextStatus);
    const updated = await client.query<WorkerRow>(
      `UPDATE workers SET status = $2, answer_text = $3, usage_total_tokens = $4, observed_at = transaction_timestamp()
       WHERE worker_id = $1 AND execution_ref = $5 AND invocation_ref = $6
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
      [workerId, nextStatus, answerText, usage, initial.executionRef, initial.invocationRef],
    );
    await client.query("COMMIT"); open = false;
    const result = mapWorker(updated.rows[0] ?? row);
    if (result.status === "succeeded" || result.status === "failed" || result.status === "cancelled") await kernel.release?.(result.invocationRef as unknown as InvocationRef).catch(() => {});
    return result;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Only the captured, currently active Head that owns this mission may cancel its worker. */
export async function cancelWorker(pool: Pool, kernel: ExecutionKernelPort, workerId: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<Worker> {
  const initial = await readWorker(pool, workerId);
  if (initial.status === "succeeded" || initial.status === "failed" || initial.status === "cancelled") return initial;

  // Authorization is checked before the external effect, then checked again
  // in the write transaction. Neither check holds a database lock while the
  // provider cancellation/observation is in flight.
  const authorize = async (workerIdToAuthorize: string): Promise<void> => {
    const client = await pool.connect(); let open = false;
    try {
      await client.query("BEGIN"); open = true;
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const current = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1 FOR UPDATE", [workerIdToAuthorize]);
      if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerIdToAuthorize}`);
      await assertWorkerAuthorization(pool, client, current.rows[0]!, proof, context);
      await client.query("COMMIT"); open = false;
    } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  };
  await authorize(workerId);

  const cancellation = await kernel.cancel(initial.invocationRef as unknown as InvocationRef);
  let nextStatus: WorkerStatus = "cancelled";
  let answerText = initial.answerText;
  let usage = initial.usageTotalTokens;
  if (!cancellation.cancelled) {
    const observations = await kernel.observe(initial.executionRef as unknown as ExecutionRef);
    const observation = observations.find((candidate) => candidate.invocation === initial.invocationRef);
    nextStatus = observation === undefined ? "unknown" : observation.status === "queued" ? "spawned" : observation.status;
    answerText = observation?.answer.state === "available" ? observation.answer.text : answerText;
    usage = observation?.usage.state === "available" ? observation.usage.totalTokens : usage;
  }

  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const current = await client.query<WorkerRow>(workerSelectSql() + " WHERE worker_id = $1 FOR UPDATE", [workerId]);
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const row = current.rows[0]!;
    if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
      await client.query("COMMIT"); open = false;
      return mapWorker(row);
    }
    await assertWorkerAuthorization(pool, client, row, proof, context);
    if (row.execution_ref !== initial.executionRef || row.invocation_ref !== initial.invocationRef) {
      await client.query("COMMIT"); open = false;
      return mapWorker(row);
    }
    assertValidWorkerTransition(row.status, nextStatus);
    const updated = await client.query<WorkerRow>(
      `UPDATE workers SET status = $2, answer_text = $3, usage_total_tokens = $4, observed_at = transaction_timestamp()
       WHERE worker_id = $1 AND execution_ref = $5 AND invocation_ref = $6
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
      [workerId, nextStatus, answerText, usage, initial.executionRef, initial.invocationRef],
    );
    await client.query("COMMIT"); open = false;
    const result = mapWorker(updated.rows[0] ?? row);
    if (nextStatus === "succeeded" || nextStatus === "failed" || nextStatus === "cancelled") await kernel.release?.(result.invocationRef as unknown as InvocationRef).catch(() => {});
    return result;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
