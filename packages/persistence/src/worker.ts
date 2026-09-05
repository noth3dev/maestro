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
  owner_id: string | null;
  owner_fencing_token: string | null;
  owner_lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  recovery_state: "none" | "fenced" | "provider_cancelled";
  cancellation_requested_at: Date | null;
  cancellation_owner_id: string | null;
  cancellation_fencing_token: string | null;
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
    ownerId: row.owner_id ?? null,
    ownerFencingToken: row.owner_fencing_token ?? null,
    ownerLeaseExpiresAt: row.owner_lease_expires_at ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    recoveryState: row.recovery_state ?? "none",
    cancellationRequestedAt: row.cancellation_requested_at ?? null,
    status: row.status,
    answerText: row.answer_text,
    usageTotalTokens: row.usage_total_tokens,
  };
}

const WORKER_COLUMNS = [
  "worker_id", "council_id", "department_id", "plan_version", "item_id", "bundle_content_hash",
  "attempt", "execution_ref", "invocation_ref", "owner_id", "owner_fencing_token",
  "owner_lease_expires_at", "heartbeat_at", "recovery_state", "cancellation_requested_at",
  "cancellation_owner_id", "cancellation_fencing_token", "status", "answer_text", "usage_total_tokens",
] as const;

function workerSelectSql(): string {
  return `SELECT ${WORKER_COLUMNS.join(", ")} FROM workers`;
}

function workerSelectWithGoalSql(): string {
  return `SELECT ${WORKER_COLUMNS.map((column) => `w.${column}`).join(", ")}, hc.goal_id
    FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id`;
}

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<Date> {
  const lease = await client.query<{ expires_at: Date }>("SELECT expires_at FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 16))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
  return lease.rows[0]!.expires_at;
}

/** Run a durable worker mutation only while the supplied Goal lease is live. */
async function withWorkerLease<T>(pool: Pool, workerId: string, proof: GoalLeaseProof, action: (client: PoolClient, worker: WorkerRow) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await lockGoalLease(client, proof);
    const current = await client.query<WorkerRow & { goal_id: string }>(
      workerSelectWithGoalSql() + " WHERE w.worker_id = $1 FOR UPDATE",
      [workerId],
    );
    if (current.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    if (current.rows[0]!.goal_id !== proof.goalId) throw new StaleGoalLeaseError(proof.goalId);
    const result = await action(client, current.rows[0]!);
    await client.query("COMMIT"); open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function assertCurrentWorkerLease(pool: Pool, workerId: string, proof: GoalLeaseProof): Promise<void> {
  await withWorkerLease(pool, workerId, proof, async () => undefined);
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
export async function promptWorkerUnderOwnerClaim(
  pool: Pool,
  kernel: ExecutionKernelPort,
  workerId: string,
  execution: ExecutionRef,
  prompt: string,
  proof: GoalLeaseProof,
): Promise<boolean> {
  return withWorkerLease(pool, workerId, proof, async (_client, worker) => {
    if (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken) return false;
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled" || worker.status === "unknown") return false;
    await kernel.prompt(execution, prompt);
    return true;
  });
}

export async function spawnWorker(pool: Pool, kernel: ExecutionKernelPort, request: SpawnWorkerRequest, proof: GoalLeaseProof, context: CouncilActorContext): Promise<Worker> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const council = await readHeadCouncil(pool, request.councilId);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    const ownerLeaseExpiresAt = await lockGoalLease(client, proof);
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
      `INSERT INTO workers (worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, status, spawn_command_id, spawn_request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::bigint, $12, transaction_timestamp(), 'none', 'spawned', $13, $14)
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [workerId, request.councilId, request.departmentId, request.planVersion, request.itemId, bundle.contentHash, nextAttempt, pendingExecution, pendingExecution, proof.ownerId, proof.fencingToken, ownerLeaseExpiresAt, request.commandId ?? null, requestHash ?? null],
    );
    await client.query("COMMIT"); open = false;
    let spawned: import("@maestro/domain").SpawnedInvocation;
    try {
      const providerRequest = {
        name: `${bundle.substance.role}:${request.itemId}:${nextAttempt}`,
        prompt: bundle.substance.goalBrief,
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        // Every field is the exact least-privilege grant this Mission Bundle
        // declared -- never widened, never inferred.
        capabilities: { allowedTools: bundle.substance.allowedTools, allowedSkills: bundle.substance.allowedSkills },
      };
      // The provider call cannot be made atomically with PostgreSQL. Check the
      // live claim immediately before admission; any response is then bound
      // identity-only so a successor can retain the opaque refs after turnover.
      await assertCurrentWorkerLease(pool, workerId, proof);
      spawned = await kernel.spawn(providerRequest);
    } catch (error) {
      // A transport timeout does not prove that the provider created nothing.
      // Keep the durable reservation ambiguous and block automatic retries
      // until reconciliation can establish the provider outcome.
      const unknown = await markUnboundWorkerUnknown(pool, workerId, proof).catch(() => undefined);
      if (unknown !== undefined) return unknown;
      throw error;
    }
    let boundWorker: Worker;
    try {
      boundWorker = await bindWorkerInvocation(pool, workerId, spawned, proof);
    } catch (error) {
      // Compensation holds the same Goal/worker owner claim through the
      // provider cancel. A stale owner cannot cancel after takeover.
      await cancelUnboundWorkerAfterBindingFailure(pool, kernel, workerId, spawned.invocation, proof).catch(() => {});
      throw error;
    }
    try {
      await promptWorkerUnderOwnerClaim(pool, kernel, workerId, spawned.execution, bundle.substance.goalBrief, proof);
    } catch {
      try { return await observeWorker(pool, kernel, workerId, proof, context); } catch { return boundWorker; }
    }
    return boundWorker;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

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

export async function markWorkerTerminal(pool: Pool, workerId: string, status: "cancelled" | "failed", proof: GoalLeaseProof): Promise<void> {
  await withWorkerLease(pool, workerId, proof, async (client) => {
    await client.query(
      "UPDATE workers SET status = $2, recovery_state = CASE WHEN $2 = 'cancelled' THEN 'provider_cancelled' ELSE recovery_state END, observed_at = transaction_timestamp() WHERE worker_id = $1 AND status IN ('spawned', 'unknown', 'running') AND owner_id = $3 AND owner_fencing_token = $4::bigint",
      [workerId, status, proof.ownerId, proof.fencingToken],
    );
  });
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
): Promise<void> {
  await withWorkerLease(pool, workerId, proof, async (client, worker) => {
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled") return;
    if (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken) throw new WorkerError("Worker owner proof is stale or fenced");
    if (!worker.execution_ref.startsWith("pending:") || !worker.invocation_ref.startsWith("pending:")) throw new WorkerError("Worker provider binding was already completed");
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
      [workerId, status, "Provider binding compensation could not confirm cancellation; reconciliation is required", proof.ownerId, proof.fencingToken],
    );
  });
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
    if (worker.owner_id !== null && (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken)) {
      throw new WorkerError("Worker owner proof is stale or fenced");
    }
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
 * Transfer ownership after a control-plane restart and conservatively fence
 * the invocation. A fresh process has no trustworthy provider session handle,
 * so it records `unknown` rather than attempting resume/reconnect or retry.
 * The unique worker decision makes recovery idempotent and retry-blocking.
 */
export async function recoverWorkerAfterRestart(
  pool: Pool,
  workerId: string,
  proof: GoalLeaseProof,
  reason: string,
): Promise<Worker> {
  if (reason.trim() === "") throw new WorkerError("Worker recovery requires a reason");
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
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
      await client.query("COMMIT"); open = false;
      return mapWorker(row);
    }
    const prior = await client.query("SELECT 1 FROM worker_recovery_decisions WHERE worker_id = $1", [workerId]);
    if (prior.rowCount === 1) {
      await client.query("COMMIT"); open = false;
      return mapWorker(row);
    }
    const updated = await client.query<WorkerRow>(
      `UPDATE workers
          SET owner_id = $2, owner_fencing_token = $3::bigint, owner_lease_expires_at = $4,
              heartbeat_at = transaction_timestamp(), recovery_state = 'fenced', status = 'unknown',
              answer_text = $5, observed_at = transaction_timestamp()
        WHERE worker_id = $1 AND status IN ('spawned', 'running', 'unknown')
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [workerId, proof.ownerId, proof.fencingToken, ownerLeaseExpiresAt, reason],
    );
    if (updated.rowCount !== 1) throw new WorkerError("Worker recovery raced with another terminal update");
    await client.query(
      `INSERT INTO worker_recovery_decisions (decision_id, worker_id, owner_id, owner_fencing_token, decision, reason)
       VALUES ($1, $2, $3, $4::bigint, 'fenced', $5)`,
      [randomUUID(), workerId, proof.ownerId, proof.fencingToken, reason],
    );
    await client.query("COMMIT"); open = false;
    return mapWorker(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/**
 * Provider observation runs outside the database transaction. The second,
 * short transaction rechecks the lease, actor binding, and worker identity
 * before recording the result, so provider latency cannot hold Goal locks.
 */
export async function observeWorker(pool: Pool, kernel: ExecutionKernelPort, workerId: string, proof: GoalLeaseProof, context?: CouncilActorContext): Promise<Worker> {
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
      `UPDATE workers SET status = $2, answer_text = $3, usage_total_tokens = $4, observed_at = transaction_timestamp(), heartbeat_at = transaction_timestamp(), owner_lease_expires_at = COALESCE((SELECT expires_at FROM goal_leases WHERE goal_id = NULLIF($7, '')::uuid AND owner_id = $8 AND fencing_token = $9::bigint), owner_lease_expires_at)
       WHERE worker_id = $1 AND execution_ref = $5 AND invocation_ref = $6
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [workerId, nextStatus, answerText, usage, initial.executionRef, initial.invocationRef, proof?.goalId ?? "", proof?.ownerId ?? "", proof?.fencingToken ?? "0"],
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
    if (worker.owner_id !== proof.ownerId || worker.owner_fencing_token !== proof.fencingToken) throw new WorkerError("Worker owner proof is stale or fenced");
    await assertWorkerAuthorization(pool, client, worker, proof, context);
    return { terminal: false as const, cancelled: (await kernel.cancel(initial.invocationRef as unknown as InvocationRef)).cancelled };
  });
  if (cancellation.terminal) return readWorker(pool, workerId);

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
      `UPDATE workers SET status = $2, answer_text = $3, usage_total_tokens = $4, observed_at = transaction_timestamp(), heartbeat_at = transaction_timestamp(), owner_lease_expires_at = COALESCE((SELECT expires_at FROM goal_leases WHERE goal_id = NULLIF($7, '')::uuid AND owner_id = $8 AND fencing_token = $9::bigint), owner_lease_expires_at)
       WHERE worker_id = $1 AND execution_ref = $5 AND invocation_ref = $6
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state, cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token, status, answer_text, usage_total_tokens`,
      [workerId, nextStatus, answerText, usage, initial.executionRef, initial.invocationRef, proof.goalId, proof.ownerId, proof.fencingToken],
    );
    await client.query("COMMIT"); open = false;
    const result = mapWorker(updated.rows[0] ?? row);
    if (nextStatus === "succeeded" || nextStatus === "failed" || nextStatus === "cancelled") await kernel.release?.(result.invocationRef as unknown as InvocationRef).catch(() => {});
    return result;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
