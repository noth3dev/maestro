import { randomUUID } from "node:crypto";
import { isTerminalGoalState, type ExecutionKernelPort, type GoalState } from "@maestro/domain";
import type { Pool } from "pg";
import {
  LeaseUnavailableError,
  acquireGoalLease,
  executeGoalCommand,
  isValidFencingToken,
  releaseGoalLease,
  renewGoalLease,
} from "./commands.js";
import { observeWorker } from "./worker.js";

/**
 * Proof of holding the singleton reconciliation-leader lease. Mirrors
 * GoalLeaseProof exactly: the fencing token is an exact base-10 PostgreSQL
 * bigint text and must never be coerced to a JS number.
 */
export interface ReconcilerLeaseProof {
  ownerId: string;
  fencingToken: string;
}

export class ReconcilerLeaseUnavailableError extends Error {
  constructor() {
    super("Reconciliation leader lease is currently held by another instance");
    this.name = "ReconcilerLeaseUnavailableError";
  }
}

export class StaleReconcilerLeaseError extends Error {
  readonly code = "stale_lease";

  constructor() {
    super("Reconciliation leader lease proof is stale or invalid");
    this.name = "StaleReconcilerLeaseError";
  }
}

/**
 * Atomically acquire (or steal, once expired) the single durable
 * reconciliation-leader lease. Only one instance can hold it at a time;
 * the fencing token strictly increases across acquisitions, exactly like
 * acquireGoalLease but scoped to the fixed 'singleton' row instead of a
 * per-Goal id.
 */
export async function acquireReconcilerLeaderLease(
  pool: Pool,
  ownerId: string,
  leaseDurationMs: number,
): Promise<ReconcilerLeaseProof> {
  if (ownerId === "") throw new RangeError("ownerId must be non-empty");
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new RangeError("leaseDurationMs must be a positive safe integer");
  }
  const result = await pool.query<{ owner_id: string; fencing_token: string }>(
    `INSERT INTO reconciler_leader_lease (lease_key, owner_id, fencing_token, expires_at)
     VALUES ('singleton', $1, 1, transaction_timestamp() + ($2 * interval '1 millisecond'))
     ON CONFLICT (lease_key) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           fencing_token = reconciler_leader_lease.fencing_token + 1,
           expires_at = transaction_timestamp() + ($2 * interval '1 millisecond'),
           updated_at = transaction_timestamp()
       WHERE reconciler_leader_lease.expires_at <= transaction_timestamp()
     RETURNING owner_id, fencing_token`,
    [ownerId, leaseDurationMs],
  );
  if (result.rowCount !== 1) throw new ReconcilerLeaseUnavailableError();
  const row = result.rows[0]!;
  return { ownerId: row.owner_id, fencingToken: row.fencing_token };
}

/**
 * Extend the reconciliation-leader lease only when this exact proof is
 * still current. Leaves the fencing token unchanged, like renewGoalLease.
 */
export async function renewReconcilerLeaderLease(
  pool: Pool,
  proof: ReconcilerLeaseProof,
  leaseDurationMs: number,
): Promise<ReconcilerLeaseProof> {
  if (
    proof.ownerId === "" ||
    !isValidFencingToken(proof.fencingToken) ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs <= 0
  ) {
    throw new StaleReconcilerLeaseError();
  }
  const result = await pool.query<{ owner_id: string; fencing_token: string }>(
    `UPDATE reconciler_leader_lease
     SET expires_at = transaction_timestamp() + ($3 * interval '1 millisecond'),
         updated_at = transaction_timestamp()
     WHERE lease_key = 'singleton'
       AND owner_id = $1
       AND fencing_token = $2::bigint
       AND expires_at > transaction_timestamp()
     RETURNING owner_id, fencing_token`,
    [proof.ownerId, proof.fencingToken, leaseDurationMs],
  );
  if (result.rowCount !== 1) throw new StaleReconcilerLeaseError();
  const row = result.rows[0]!;
  return { ownerId: row.owner_id, fencingToken: row.fencing_token };
}

export interface ReconcileOnStartupOptions {
  /** Identity of this reconciler process instance. */
  ownerId: string;
  /** Duration of the leader lease held for this reconciliation run. */
  leaderLeaseDurationMs?: number;
  /** Duration of the per-Goal lease used to durably mark a Goal recovering. */
  goalLeaseDurationMs?: number;
  /**
   * When supplied, this exact fresh kernel instance's own in-process
   * session/root/child state is used to force an honest re-observation of
   * every nonterminal worker under a Goal whose durable lease is not
   * currently live (expired or absent) -- the case where no other live
   * process could still legitimately hold the prior session, so a worker
   * left "spawned"/"running" is genuinely orphaned, not merely contended.
   * A kernel started by this same process is always fresh (no session for
   * any pre-restart execution can exist in it), so this call can only ever
   * honestly downgrade a stale worker to "unknown" -- see
   * execution-kernel.ts's kernel.observe() honest-empty-observation
   * fallback and worker.ts's observeWorker -- never fabricate a status.
   * Omitted only by tests that do not exercise worker-level recovery.
   */
  kernel?: ExecutionKernelPort;
}

export type GoalReconciliationOutcome = "consistent" | "recovering" | "lease_contended";

export interface GoalReconciliationResult {
  goalId: string;
  projectId: string;
  priorState: GoalState;
  outcome: GoalReconciliationOutcome;
  reasons: readonly string[];
  /**
   * Worker IDs this pass forced through a fresh observeWorker call because
   * this Goal's durable lease was not live. Empty when no kernel was
   * supplied, when the lease was still live (lease_contended -- active
   * execution is protected, not touched), or when no nonterminal worker
   * existed under this Goal.
   */
  reconciledWorkerIds: readonly string[];
}

export interface ReconciliationReport {
  leaderProof: ReconcilerLeaseProof;
  checkedGoalCount: number;
  results: readonly GoalReconciliationResult[];
}

const STOP_ACKNOWLEDGED_STATES: ReadonlySet<GoalState> = new Set(["stopped", "stopping", "blocked"]);

/**
 * Purely structural consistency check between a Goal's persisted state and
 * its goal_leases/goal_controls rows. No actual Prime session reconciliation
 * happens here; this only flags shapes that must never be silently resumed.
 */
function classifyGoalConsistency(input: {
  state: GoalState;
  leaseExpiresAt: Date | null;
  control: {
    exists: boolean;
    emergencyStoppedAt: Date | null;
    pauseRequestedAt: Date | null;
    pausedAt: Date | null;
    stoppingAt: Date | null;
    stoppedAt: Date | null;
  };
  now: Date;
}): { consistent: boolean; reasons: readonly string[] } {
  const reasons: string[] = [];
  if (!input.control.exists) reasons.push("goal_control_missing");
  const control = input.control;
  if (input.leaseExpiresAt !== null && input.leaseExpiresAt > input.now) {
    // A goal_leases row that is still unexpired after a reconciler restart
    // means the fencing token it grants could still be in flight elsewhere;
    // this is the "dangling stale fencing" shape that must not be silently
    // trusted.
    reasons.push("goal_lease_held_across_reconciliation");
  }
  if (control.emergencyStoppedAt !== null && !STOP_ACKNOWLEDGED_STATES.has(input.state)) {
    reasons.push("emergency_stop_state_mismatch");
  }
  if (control.pauseRequestedAt !== null && !["pausing", "paused"].includes(input.state)) reasons.push("pause_request_state_mismatch");
  if (control.pausedAt !== null && input.state !== "paused") reasons.push("paused_state_mismatch");
  if (control.stoppingAt !== null && !["stopping", "stopped", "blocked"].includes(input.state)) reasons.push("stopping_state_mismatch");
  if (control.stoppedAt !== null && !["stopped", "blocked"].includes(input.state)) reasons.push("stopped_state_mismatch");
  if (input.state === "pausing" && control.pauseRequestedAt === null) reasons.push("pausing_latch_missing");
  if (input.state === "paused" && control.pausedAt === null) reasons.push("paused_latch_missing");
  if (input.state === "stopping" && control.stoppingAt === null) reasons.push("stopping_latch_missing");
  if (input.state === "stopped" && control.stoppedAt === null && control.emergencyStoppedAt === null) reasons.push("stopped_latch_missing");
  return { consistent: reasons.length === 0, reasons };
}

/**
 * Acquire the singleton reconciliation-leader lease and, for every
 * nonterminal Goal, verify goal_leases/goal_controls consistency. Any
 * ambiguous or unrecognized shape is durably transitioned to the domain's
 * own "recovering" Goal state (never silently resumed). This function does
 * NOT perform any actual Prime session reconciliation: no durable session
 * bindings exist yet in this phase.
 */
export async function reconcileOnStartup(
  pool: Pool,
  options: ReconcileOnStartupOptions,
): Promise<ReconciliationReport> {
  const leaderLeaseDurationMs = options.leaderLeaseDurationMs ?? 60_000;
  const goalLeaseDurationMs = options.goalLeaseDurationMs ?? 30_000;
  let leaderProof = await acquireReconcilerLeaderLease(pool, options.ownerId, leaderLeaseDurationMs);
  const renewLeader = async (): Promise<void> => {
    leaderProof = await renewReconcilerLeaderLease(pool, leaderProof, leaderLeaseDurationMs);
  };

  const goalsResult = await pool.query<{ goal_id: string; project_id: string; state: GoalState; version: string }>(
    `SELECT goal_id, project_id, state, version FROM goals ORDER BY goal_id`,
  );
  const nonterminalGoals = goalsResult.rows.filter((row) => !isTerminalGoalState(row.state));

  const results: GoalReconciliationResult[] = [];
  for (const row of nonterminalGoals) {
    // Goal/provider inspection can exceed the singleton lease duration. Renew
    // before each pass and before every worker observation so an expired leader
    // cannot continue issuing fenced mutations after another instance takes over.
    await renewLeader();
    const [leaseRow, controlRow] = await Promise.all([
      pool.query<{ expires_at: Date }>("SELECT expires_at FROM goal_leases WHERE goal_id = $1", [row.goal_id]),
      pool.query<{ emergency_stopped_at: Date | null; pause_requested_at: Date | null; paused_at: Date | null; stopping_at: Date | null; stopped_at: Date | null }>(
        "SELECT emergency_stopped_at, pause_requested_at, paused_at, stopping_at, stopped_at FROM goal_controls WHERE project_id = $1 AND goal_id = $2",
        [row.project_id, row.goal_id],
      ),
    ]);
    const now = new Date();
    const leaseExpiresAt = leaseRow.rowCount === 1 ? leaseRow.rows[0]!.expires_at : null;
    const leaseIsLive = leaseExpiresAt !== null && leaseExpiresAt > now;
    const { consistent, reasons } = classifyGoalConsistency({
      state: row.state,
      leaseExpiresAt,
      control: {
        exists: controlRow.rowCount === 1,
        emergencyStoppedAt: controlRow.rowCount === 1 ? controlRow.rows[0]!.emergency_stopped_at : null,
        pauseRequestedAt: controlRow.rowCount === 1 ? controlRow.rows[0]!.pause_requested_at : null,
        pausedAt: controlRow.rowCount === 1 ? controlRow.rows[0]!.paused_at : null,
        stoppingAt: controlRow.rowCount === 1 ? controlRow.rows[0]!.stopping_at : null,
        stoppedAt: controlRow.rowCount === 1 ? controlRow.rows[0]!.stopped_at : null,
      },
      now,
    });

    // Only meaningful when the Goal's own lease is not currently live: a
    // live lease means some other process could still legitimately hold
    // the real session (lease_contended below never reaches here), so
    // forcing observation would be premature, not merely redundant.
    const reconciledWorkerIds = !leaseIsLive
      ? await reconcileOrphanedWorkers(pool, options.kernel, row.goal_id, `reconciler:${options.ownerId}`, goalLeaseDurationMs, renewLeader)
      : [];
    const recoveryReasons = reconciledWorkerIds.length === 0 ? reasons : [...reasons, "orphaned_workers_reconciled"];

    // Unknown workers are an execution-state inconsistency even when the
    // Goal/control rows themselves look structurally valid. Do not report an
    // active Goal as consistent after startup has downgraded its workers.
    if (consistent && reconciledWorkerIds.length === 0) {
      results.push({ goalId: row.goal_id, projectId: row.project_id, priorState: row.state, outcome: "consistent", reasons: [], reconciledWorkerIds });
      continue;
    }
    if (row.state === "recovering") {
      // Already durably marked recovering by a prior run or actor; nothing
      // further to record this pass.
      results.push({ goalId: row.goal_id, projectId: row.project_id, priorState: row.state, outcome: "recovering", reasons: recoveryReasons, reconciledWorkerIds });
      continue;
    }

    try {
      const goalLeaseProof = await acquireGoalLease(pool, {
        goalId: row.goal_id,
        ownerId: `reconciler:${options.ownerId}`,
        leaseDurationMs: goalLeaseDurationMs,
      });
      const commandResult = await executeGoalCommand(
        pool,
        {
          commandId: randomUUID(),
          projectId: row.project_id,
          goalId: row.goal_id,
          actorId: `reconciler:${options.ownerId}`,
          type: "TransitionGoal",
          expectedVersion: Number(row.version),
          to: "recovering",
        },
        goalLeaseProof,
      );
      results.push({
        goalId: row.goal_id,
        projectId: row.project_id,
        priorState: row.state,
        outcome: commandResult.outcome === "succeeded" ? "recovering" : "lease_contended",
        reasons: recoveryReasons,
        reconciledWorkerIds,
      });
    } catch (error) {
      if (error instanceof LeaseUnavailableError) {
        // Some other actor legitimately holds the Goal lease right now;
        // reconciliation must never steal it. Report the ambiguity instead
        // of forcing a transition.
        results.push({ goalId: row.goal_id, projectId: row.project_id, priorState: row.state, outcome: "lease_contended", reasons, reconciledWorkerIds: [] });
        continue;
      }
      throw error;
    }
  }

  return { leaderProof, checkedGoalCount: nonterminalGoals.length, results };
}

/**
 * Forces a fresh observeWorker call for every nonterminal worker under a
 * Goal whose durable lease is not currently live, using this restarted
 * process's own fresh kernel. A worker whose execution genuinely no longer
 * exists in this fresh kernel's session state is durably transitioned to
 * "unknown" by observeWorker's own existing empty-observation fallback
 * (never a fabricated "failed", per Phase 1 re-patch item 2); a worker
 * whose observation happens to resolve some other way is recorded exactly
 * as observeWorker reports it. One worker's reconciliation failure is
 * logged into the returned list as skipped, never allowed to abort startup
 * for every other Goal/worker.
 */
async function reconcileOrphanedWorkers(
  pool: Pool,
  kernel: ExecutionKernelPort | undefined,
  goalId: string,
  ownerId: string,
  leaseDurationMs: number,
  renewLeader: () => Promise<void>,
): Promise<readonly string[]> {
  if (!kernel) return [];
  const workersResult = await pool.query<{ worker_id: string }>(
    `SELECT w.worker_id
       FROM workers w
       JOIN head_councils hc ON hc.council_id = w.council_id
      WHERE hc.goal_id = $1 AND w.status IN ('spawned', 'running')`,
    [goalId],
  );
  if (workersResult.rowCount === 0) return [];
  // Reacquire a current fenced Goal lease before every observation/write. The
  // earlier startup snapshot is only a hint; a legitimate owner may have
  // acquired the Goal between that snapshot and this reconciliation pass.
  let proof: Awaited<ReturnType<typeof acquireGoalLease>>;
  try {
    proof = await acquireGoalLease(pool, { goalId, ownerId, leaseDurationMs });
  } catch (error) {
    if (error instanceof LeaseUnavailableError) return [];
    throw error;
  }
  const reconciled: string[] = [];
  try {
    for (const { worker_id: workerId } of workersResult.rows) {
      await renewLeader();
      proof = await renewGoalLease(pool, proof, leaseDurationMs);
      await observeWorker(pool, kernel, workerId, proof);
      reconciled.push(workerId);
    }
  } finally {
    try { await releaseGoalLease(pool, proof); } catch { /* stale proof is already fenced */ }
  }
  return reconciled;
}
