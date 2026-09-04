import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AuthorityClaimConflictError } from "@maestro/authority";
import type { ActionRequest, AuthorityDecisionAudit, AuthorityRecord, AuthorityRepository, ControlRecheck } from "@maestro/authority";

export interface BootstrapAuthorityRecordInput extends Omit<ActionRequest, "controlEpoch" | "commandId"> {
  /** Optional for controlled setup callers; API command identity uses it as the durable record key. */
  recordId?: string;
  kind: "grant" | "approval";
  commandId: string | null;
  expiresAt: Date;
  /** Retained for backwards compatibility with setup fixtures; authority records do not scope epochs. */
  controlEpoch?: string;
}

export type AuthorityApprovalInput = Omit<BootstrapAuthorityRecordInput, "kind" | "recordId" | "controlEpoch" | "commandId"> & {
  recordId: string;
  commandId: string;
};

export class AuthorityApprovalConflictError extends Error {
  constructor() {
    super("Authority approval identity was reused with different content");
    this.name = "AuthorityApprovalConflictError";
  }
}

/** Controlled setup helper. It only creates new immutable authority records. */
export async function bootstrapAuthorityRecord(pool: Pool, input: BootstrapAuthorityRecordInput): Promise<AuthorityRecord> {
  const recordId = input.recordId ?? randomUUID();
  if (input.kind === "approval" && input.commandId === "") throw new Error("approval requires commandId");
  const commandId = input.kind === "grant" ? null : input.commandId;
  const result = await pool.query<StoredAuthorityRecord>(
    `INSERT INTO authority_records
     (record_id, kind, command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [recordId, input.kind, commandId, input.projectId, input.goalId, input.actorId, input.action, input.target,
      input.policyVersion, String(input.budgetEffectCents), input.expiresAt],
  );
  return toAuthorityRecord(result.rows[0]!);
}

/**
 * Issues one command-bound approval for a user-facing approval flow. The
 * record ID is the approval command identity, so retries are idempotent and
 * a changed retry cannot silently broaden the approved action.
 */
export async function issueAuthorityApproval(pool: Pool, input: AuthorityApprovalInput): Promise<AuthorityRecord> {
  const commandId = input.commandId;
  if (commandId === "") throw new AuthorityApprovalConflictError();
  await pool.query(
    `INSERT INTO authority_records
     (record_id, kind, command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents, expires_at)
     VALUES ($1, 'approval', $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (record_id) DO NOTHING`,
    [input.recordId, commandId, input.projectId, input.goalId, input.actorId, input.action, input.target,
      input.policyVersion, String(input.budgetEffectCents), input.expiresAt],
  );
  const result = await pool.query<StoredAuthorityRecord>("SELECT * FROM authority_records WHERE record_id = $1", [input.recordId]);
  if (result.rowCount !== 1) throw new AuthorityApprovalConflictError();
  const record = toAuthorityRecord(result.rows[0]!);
  if (record.kind !== "approval" || record.commandId !== commandId || record.projectId !== input.projectId ||
      record.goalId !== input.goalId || record.actorId !== input.actorId || record.action !== input.action ||
      record.target !== input.target || record.policyVersion !== input.policyVersion ||
      record.budgetEffectCents !== input.budgetEffectCents || record.expiresAt.getTime() !== input.expiresAt.getTime()) {
    throw new AuthorityApprovalConflictError();
  }
  return record;
}

/** Revocation can occur once; migration-level guards make it final. */
export async function revokeAuthorityRecord(pool: Pool, recordId: string): Promise<void> {
  const result = await pool.query(
    "UPDATE authority_records SET revoked_at = transaction_timestamp() WHERE record_id = $1 AND revoked_at IS NULL",
    [recordId],
  );
  if (result.rowCount !== 1) throw new Error("Authority record is missing or already revoked");
}

export class PostgresAuthorityRepository implements AuthorityRepository {
  constructor(private readonly pool: Pool) {}

  async load(request: ActionRequest): Promise<readonly AuthorityRecord[]> {
    const result = await this.pool.query<StoredAuthorityRecord>(
      `SELECT * FROM authority_records
       WHERE project_id = $1 AND goal_id = $2 AND actor_id = $3 AND action = $4 AND target = $5
         AND policy_version = $6 AND budget_effect_cents = $7::bigint`,
      [request.projectId, request.goalId, request.actorId, request.action, request.target,
        request.policyVersion, String(request.budgetEffectCents)],
    );
    return result.rows.map(toAuthorityRecord);
  }

  async appendDecision(audit: AuthorityDecisionAudit): Promise<void> {
    const { decision, decidedAt } = audit;
    const request = decision.request;
    await this.pool.query(
      `INSERT INTO authority_decisions
       (decision_id, command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents,
        outcome, reason, classification, matched_record_id, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [randomUUID(), request.commandId, request.projectId, request.goalId, request.actorId, request.action, request.target,
        request.policyVersion, String(request.budgetEffectCents), decision.effect, decision.reason, decision.classification,
        decision.recordId ?? null, decidedAt],
    );
  }

  async claimEffect(request: ActionRequest): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO authority_effect_claims
       (command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (command_id, action, target) DO NOTHING`,
      [request.commandId, request.projectId, request.goalId, request.actorId, request.action, request.target,
        request.policyVersion, String(request.budgetEffectCents)],
    );
    if (result.rowCount === 1) return true;
    const existing = await this.pool.query<{ project_id: string; goal_id: string; actor_id: string; policy_version: number; budget_effect_cents: string }>(
      `SELECT project_id, goal_id, actor_id, policy_version, budget_effect_cents
       FROM authority_effect_claims WHERE command_id = $1 AND action = $2 AND target = $3`,
      [request.commandId, request.action, request.target],
    );
    const claim = existing.rows[0];
    if (claim === undefined || claim.project_id !== request.projectId || claim.goal_id !== request.goalId ||
        claim.actor_id !== request.actorId || claim.policy_version !== request.policyVersion ||
        claim.budget_effect_cents !== String(request.budgetEffectCents)) throw new AuthorityClaimConflictError();
    return false;
  }

  async recheckControl(request: ActionRequest): Promise<ControlRecheck> {
    // Never create authority state for a forged Goal identity. The Goal
    // projection is the source of truth for project binding and lifecycle.
    const goal = await this.pool.query<{ state: string }>(
      "SELECT state FROM goals WHERE goal_id = $1 AND project_id = $2",
      [request.goalId, request.projectId],
    );
    if (goal.rowCount !== 1) return { effect: "deny", reason: "goal_not_found" };
    if (!["launched", "active", "pausing", "resuming", "certifying"].includes(goal.rows[0]!.state)) {
      return { effect: "deny", reason: "goal_not_executable" };
    }
    // A Goal with no explicit control action yet is implicitly open at epoch 1.
    await this.pool.query(
      `INSERT INTO goal_controls (project_id, goal_id) VALUES ($1, $2)
       ON CONFLICT (project_id, goal_id) DO NOTHING`,
      [request.projectId, request.goalId],
    );
    const result = await this.pool.query<StoredGoalControl>(
      "SELECT * FROM goal_controls WHERE project_id = $1 AND goal_id = $2",
      [request.projectId, request.goalId],
    );
    const control = result.rows[0]!;
    // Each latch dominates an epoch mismatch, which can also occur for other
    // reasons; emergency stop and full stop are terminal and take priority
    // over their requested-but-not-yet-confirmed predecessor states.
    if (control.emergency_stopped_at !== null) {
      return { effect: "deny", reason: "emergency_stop" };
    }
    if (control.stopped_at !== null) {
      return { effect: "deny", reason: "stopped" };
    }
    if (control.stopping_at !== null) {
      return { effect: "deny", reason: "stopping" };
    }
    if (control.paused_at !== null) {
      return { effect: "deny", reason: "paused" };
    }
    if (control.pause_requested_at !== null) {
      return { effect: "deny", reason: "pause_requested" };
    }
    if (control.control_epoch !== request.controlEpoch) {
      return { effect: "deny", reason: "stale_control_epoch" };
    }
    return { effect: "allow" };
  }
}

type StoredAuthorityRecord = {
  record_id: string; kind: "grant" | "approval"; command_id: string | null; project_id: string; goal_id: string;
  actor_id: string; action: string; target: string; policy_version: number; budget_effect_cents: string; expires_at: Date; issued_at: Date; revoked_at: Date | null;
};
function toAuthorityRecord(row: StoredAuthorityRecord): AuthorityRecord {
  return {
    recordId: row.record_id, kind: row.kind, commandId: row.command_id, projectId: row.project_id, goalId: row.goal_id,
    actorId: row.actor_id, action: row.action, target: row.target, policyVersion: row.policy_version,
    budgetEffectCents: Number(row.budget_effect_cents), expiresAt: row.expires_at, issuedAt: row.issued_at,
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}


export interface GoalControl {
  projectId: string;
  goalId: string;
  /** Exact PostgreSQL bigint text; do not coerce it to a JavaScript number. */
  controlEpoch: string;
  emergencyStoppedAt?: Date;
  pauseRequestedAt?: Date;
  pausedAt?: Date;
  stoppingAt?: Date;
  stoppedAt?: Date;
}

/**
 * Durable mode derived from the latch/timestamp columns, in dominance order.
 * Emergency stop and full stop are terminal; "stopping"/"pause_requested" are
 * the requested-but-not-yet-confirmed predecessors of "stopped"/"paused".
 */
type GoalControlMode = "emergency_stopped" | "stopped" | "stopping" | "paused" | "pause_requested" | "open";

type StoredGoalControl = {
  project_id: string;
  goal_id: string;
  control_epoch: string;
  emergency_stopped_at: Date | null;
  pause_requested_at: Date | null;
  paused_at: Date | null;
  stopping_at: Date | null;
  stopped_at: Date | null;
};

function toGoalControl(row: StoredGoalControl): GoalControl {
  return {
    projectId: row.project_id,
    goalId: row.goal_id,
    controlEpoch: row.control_epoch,
    ...(row.emergency_stopped_at === null ? {} : { emergencyStoppedAt: row.emergency_stopped_at }),
    ...(row.pause_requested_at === null ? {} : { pauseRequestedAt: row.pause_requested_at }),
    ...(row.paused_at === null ? {} : { pausedAt: row.paused_at }),
    ...(row.stopping_at === null ? {} : { stoppingAt: row.stopping_at }),
    ...(row.stopped_at === null ? {} : { stoppedAt: row.stopped_at }),
  };
}

function goalControlMode(row: StoredGoalControl): GoalControlMode {
  if (row.emergency_stopped_at !== null) return "emergency_stopped";
  if (row.stopped_at !== null) return "stopped";
  if (row.stopping_at !== null) return "stopping";
  if (row.paused_at !== null) return "paused";
  if (row.pause_requested_at !== null) return "pause_requested";
  return "open";
}

/** Returns the durable control state, creating the initial unlatched epoch once. */
export async function getGoalControl(pool: Pool, projectId: string, goalId: string): Promise<GoalControl> {
  await pool.query(
    `INSERT INTO goal_controls (project_id, goal_id) VALUES ($1, $2)
     ON CONFLICT (project_id, goal_id) DO NOTHING`,
    [projectId, goalId],
  );
  const result = await pool.query<StoredGoalControl>(
    "SELECT * FROM goal_controls WHERE project_id = $1 AND goal_id = $2",
    [projectId, goalId],
  );
  return toGoalControl(result.rows[0]!);
}

/**
 * Latches a Goal permanently for this phase, advances its epoch once, and
 * revokes every currently active authority record for that Goal atomically.
 */
export async function emergencyStopGoal(pool: Pool, projectId: string, goalId: string): Promise<GoalControl> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO goal_controls (project_id, goal_id) VALUES ($1, $2)
       ON CONFLICT (project_id, goal_id) DO NOTHING`,
      [projectId, goalId],
    );
    const control = await client.query<StoredGoalControl>(
      "SELECT * FROM goal_controls WHERE project_id = $1 AND goal_id = $2 FOR UPDATE",
      [projectId, goalId],
    );
    const current = control.rows[0]!;
    if (current.emergency_stopped_at === null) {
      await client.query(
        `UPDATE goal_controls
         SET control_epoch = control_epoch + 1, emergency_stopped_at = transaction_timestamp()
         WHERE project_id = $1 AND goal_id = $2`,
        [projectId, goalId],
      );
      await client.query(
        `UPDATE authority_records SET revoked_at = transaction_timestamp()
         WHERE project_id = $1 AND goal_id = $2 AND revoked_at IS NULL`,
        [projectId, goalId],
      );
    }
    const result = await client.query<StoredGoalControl>(
      "SELECT * FROM goal_controls WHERE project_id = $1 AND goal_id = $2",
      [projectId, goalId],
    );
    await client.query("COMMIT");
    return toGoalControl(result.rows[0]!);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


/**
 * Shared transaction skeleton for every pause/stop/resume transition: lock
 * the Goal's control row, let the caller validate the current mode and apply
 * its update, then return the durable result. A validation failure (thrown
 * inside `apply`) rolls the whole transaction back with no partial write.
 */
async function transitionGoalControlInTransaction(
  client: PoolClient,
  projectId: string,
  goalId: string,
  apply: (client: PoolClient, current: StoredGoalControl) => Promise<void>,
): Promise<GoalControl> {
  await client.query(
    `INSERT INTO goal_controls (project_id, goal_id) VALUES ($1, $2)
     ON CONFLICT (project_id, goal_id) DO NOTHING`,
    [projectId, goalId],
  );
  const control = await client.query<StoredGoalControl>(
    "SELECT * FROM goal_controls WHERE project_id = $1 AND goal_id = $2 FOR UPDATE",
    [projectId, goalId],
  );
  const current = control.rows[0]!;
  await apply(client, current);
  const result = await client.query<StoredGoalControl>(
    "SELECT * FROM goal_controls WHERE project_id = $1 AND goal_id = $2",
    [projectId, goalId],
  );
  return toGoalControl(result.rows[0]!);
}

async function transitionGoalControl(
  pool: Pool,
  projectId: string,
  goalId: string,
  apply: (client: PoolClient, current: StoredGoalControl) => Promise<void>,
): Promise<GoalControl> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await transitionGoalControlInTransaction(client, projectId, goalId, apply);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function applyPauseRequest(client: PoolClient, projectId: string, goalId: string, current: StoredGoalControl): Promise<void> {
  const mode = goalControlMode(current);
  if (mode === "pause_requested") return;
  if (mode !== "open") {
    throw new Error(`cannot request pause from mode "${mode}" (expected "open")`);
  }
  await client.query(
    `UPDATE goal_controls
     SET control_epoch = control_epoch + 1, pause_requested_at = transaction_timestamp()
     WHERE project_id = $1 AND goal_id = $2`,
    [projectId, goalId],
  );
}

/**
 * Apply the pause transition to an already-open caller transaction. The
 * caller owns BEGIN/COMMIT so related durable records can commit atomically.
 */
export async function requestPauseGoalInTransaction(client: PoolClient, projectId: string, goalId: string): Promise<GoalControl> {
  return transitionGoalControlInTransaction(client, projectId, goalId, (connection, current) => applyPauseRequest(connection, projectId, goalId, current));
}

/**
 * Requests a pause: advances the epoch once and denies further effects with
 * reason "pause_requested" immediately (no work quiescence is implemented in
 * this phase; that only becomes meaningful once execution workers exist).
 * Idempotent while already pause-requested; invalid from any other mode.
 */
export async function requestPauseGoal(pool: Pool, projectId: string, goalId: string): Promise<GoalControl> {
  return transitionGoalControl(pool, projectId, goalId, (client, current) => applyPauseRequest(client, projectId, goalId, current));
}

/**
 * Confirms a previously requested pause as fully paused, advancing the epoch
 * again. Valid only immediately after `requestPauseGoal`; a Goal that has
 * since had stop requested (or was never pause-requested) is rejected.
 */
export async function confirmPausedGoal(pool: Pool, projectId: string, goalId: string): Promise<GoalControl> {
  return transitionGoalControl(pool, projectId, goalId, async (client, current) => {
    const mode = goalControlMode(current);
    if (mode !== "pause_requested") {
      throw new Error(`cannot confirm pause from mode "${mode}" (expected "pause_requested")`);
    }
    await client.query(
      `UPDATE goal_controls
       SET control_epoch = control_epoch + 1, paused_at = transaction_timestamp()
       WHERE project_id = $1 AND goal_id = $2`,
      [projectId, goalId],
    );
  });
}

const STOP_SOURCE_MODES: readonly GoalControlMode[] = ["open", "pause_requested", "paused"];

/**
 * Requests a stop from an open, pause-requested, or fully paused Goal,
 * advancing the epoch and denying further effects with reason "stopping".
 * Not idempotent: requesting stop again while already stopping (or from any
 * terminal mode) is rejected, matching the durable audit-once intent.
 */
export async function requestStopGoal(pool: Pool, projectId: string, goalId: string): Promise<GoalControl> {
  return transitionGoalControl(pool, projectId, goalId, async (client, current) => {
    const mode = goalControlMode(current);
    if (!STOP_SOURCE_MODES.includes(mode)) {
      throw new Error(`cannot request stop from mode "${mode}" (expected one of: ${STOP_SOURCE_MODES.join(", ")})`);
    }
    await client.query(
      `UPDATE goal_controls
       SET control_epoch = control_epoch + 1, stopping_at = transaction_timestamp()
       WHERE project_id = $1 AND goal_id = $2`,
      [projectId, goalId],
    );
  });
}

/**
 * Confirms a previously requested stop as fully stopped: a terminal mode
 * like emergency stop, so it also revokes every currently active authority
 * record for the Goal atomically. Valid only immediately after
 * `requestStopGoal`.
 */
export async function confirmStoppedGoal(pool: Pool, projectId: string, goalId: string): Promise<GoalControl> {
  return transitionGoalControl(pool, projectId, goalId, async (client, current) => {
    const mode = goalControlMode(current);
    if (mode !== "stopping") {
      throw new Error(`cannot confirm stop from mode "${mode}" (expected "stopping")`);
    }
    await client.query(
      `UPDATE goal_controls
       SET control_epoch = control_epoch + 1, stopped_at = transaction_timestamp()
       WHERE project_id = $1 AND goal_id = $2`,
      [projectId, goalId],
    );
    await client.query(
      `UPDATE authority_records SET revoked_at = transaction_timestamp()
       WHERE project_id = $1 AND goal_id = $2 AND revoked_at IS NULL`,
      [projectId, goalId],
    );
  });
}

/**
 * Resumes a fully paused Goal, advancing the epoch once more and clearing
 * the pause timestamps so the Goal returns to the open mode. Requires the
 * Goal to be exactly in "paused" mode: resume from pause-requested, stopping,
 * stopped, or emergency-stopped is rejected.
 */
export async function resumeGoal(pool: Pool, projectId: string, goalId: string): Promise<GoalControl> {
  return transitionGoalControl(pool, projectId, goalId, async (client, current) => {
    const mode = goalControlMode(current);
    if (mode !== "paused") {
      throw new Error(`cannot resume from mode "${mode}" (expected "paused")`);
    }
    await client.query(
      `UPDATE goal_controls
       SET control_epoch = control_epoch + 1, pause_requested_at = NULL, paused_at = NULL
       WHERE project_id = $1 AND goal_id = $2`,
      [projectId, goalId],
    );
  });
}
