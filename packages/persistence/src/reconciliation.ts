import { randomUUID } from "node:crypto";
import { isTerminalGoalState, type GoalState } from "@maestro/domain";
import type { Pool } from "pg";
import {
  LeaseUnavailableError,
  acquireGoalLease,
  executeGoalCommand,
  isValidFencingToken,
} from "./commands.js";

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
}

export type GoalReconciliationOutcome = "consistent" | "recovering" | "lease_contended";

export interface GoalReconciliationResult {
  goalId: string;
  projectId: string;
  priorState: GoalState;
  outcome: GoalReconciliationOutcome;
  reasons: readonly string[];
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
  emergencyStoppedAt: Date | null;
  now: Date;
}): { consistent: boolean; reasons: readonly string[] } {
  const reasons: string[] = [];
  if (input.leaseExpiresAt !== null && input.leaseExpiresAt > input.now) {
    // A goal_leases row that is still unexpired after a reconciler restart
    // means the fencing token it grants could still be in flight elsewhere;
    // this is the "dangling stale fencing" shape that must not be silently
    // trusted.
    reasons.push("goal_lease_held_across_reconciliation");
  }
  if (input.emergencyStoppedAt !== null && !STOP_ACKNOWLEDGED_STATES.has(input.state)) {
    reasons.push("emergency_stop_state_mismatch");
  }
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
  const leaderProof = await acquireReconcilerLeaderLease(pool, options.ownerId, leaderLeaseDurationMs);

  const goalsResult = await pool.query<{ goal_id: string; project_id: string; state: GoalState; version: string }>(
    `SELECT goal_id, project_id, state, version FROM goals ORDER BY goal_id`,
  );
  const nonterminalGoals = goalsResult.rows.filter((row) => !isTerminalGoalState(row.state));

  const results: GoalReconciliationResult[] = [];
  for (const row of nonterminalGoals) {
    const [leaseRow, controlRow] = await Promise.all([
      pool.query<{ expires_at: Date }>("SELECT expires_at FROM goal_leases WHERE goal_id = $1", [row.goal_id]),
      pool.query<{ emergency_stopped_at: Date | null }>(
        "SELECT emergency_stopped_at FROM goal_controls WHERE project_id = $1 AND goal_id = $2",
        [row.project_id, row.goal_id],
      ),
    ]);
    const { consistent, reasons } = classifyGoalConsistency({
      state: row.state,
      leaseExpiresAt: leaseRow.rowCount === 1 ? leaseRow.rows[0]!.expires_at : null,
      emergencyStoppedAt: controlRow.rowCount === 1 ? controlRow.rows[0]!.emergency_stopped_at : null,
      now: new Date(),
    });

    if (consistent) {
      results.push({ goalId: row.goal_id, projectId: row.project_id, priorState: row.state, outcome: "consistent", reasons: [] });
      continue;
    }
    if (row.state === "recovering") {
      // Already durably marked recovering by a prior run or actor; nothing
      // further to record this pass.
      results.push({ goalId: row.goal_id, projectId: row.project_id, priorState: row.state, outcome: "recovering", reasons });
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
        reasons,
      });
    } catch (error) {
      if (error instanceof LeaseUnavailableError) {
        // Some other actor legitimately holds the Goal lease right now;
        // reconciliation must never steal it. Report the ambiguity instead
        // of forcing a transition.
        results.push({ goalId: row.goal_id, projectId: row.project_id, priorState: row.state, outcome: "lease_contended", reasons });
        continue;
      }
      throw error;
    }
  }

  return { leaderProof, checkedGoalCount: nonterminalGoals.length, results };
}
