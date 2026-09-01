import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ActionRequest, AuthorityDecisionAudit, AuthorityRecord, AuthorityRepository, ControlRecheck } from "@maestro/authority";

export interface BootstrapAuthorityRecordInput extends ActionRequest {
  recordId?: string;
  kind: "grant" | "approval";
  expiresAt: Date;
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

  async recheckControl(request: ActionRequest): Promise<ControlRecheck> {
    // A Goal with no explicit control action yet is implicitly open at epoch 1,
    // matching getGoalControl's lazily created default. Ensure that row exists
    // so comparison below is against durable truth rather than an absent row.
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
    // Emergency stop is a permanent latch and takes priority over an epoch
    // mismatch, which can also occur for other reasons.
    if (control.emergency_stopped_at !== null) {
      return { effect: "deny", reason: "emergency_stop" };
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
}

type StoredGoalControl = {
  project_id: string;
  goal_id: string;
  control_epoch: string;
  emergency_stopped_at: Date | null;
};

function toGoalControl(row: StoredGoalControl): GoalControl {
  return {
    projectId: row.project_id,
    goalId: row.goal_id,
    controlEpoch: row.control_epoch,
    ...(row.emergency_stopped_at === null ? {} : { emergencyStoppedAt: row.emergency_stopped_at }),
  };
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
