import type { GoalHeadParticipation, HeadParticipationStatus } from "@maestro/domain";
import { StaleGoalLeaseError, type GoalLeaseProof } from "../commands.js";
import { assertGoalControlOpen } from "../council.js";
import type { Pool } from "pg";
import {
  HeadActivationBindingConflictError,
  HeadActivationRuntimeConflictError,
  type HeadActivationCommandRecoveryRow,
  type HeadActivationCommandStatus,
  type ParticipationRow,
} from "./types.js";
import { assertCurrentGoalLease, assertGoalLeaseOwnership, mapParticipation, validProof } from "./shared.js";

/** Atomically claims the provider-spawn step for one activation command. */
export async function markHeadActivationSpawnStarted(
  pool: Pool,
  goalId: string,
  departmentId: string,
  commandId: string,
  proof: GoalLeaseProof,
): Promise<boolean> {
  if (goalId !== proof.goalId || !validProof(proof) || commandId.trim() === "") throw new StaleGoalLeaseError(goalId);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await assertCurrentGoalLease(client, proof);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [goalId]);
    await assertGoalControlOpen(client, goalId);
    const result = await client.query(
      `UPDATE head_activation_commands
          SET status = 'spawn_started', updated_at = transaction_timestamp()
        WHERE command_id = $1 AND goal_id = $2 AND department_id = $3 AND status = 'reserved'`,
      [commandId, goalId, departmentId],
    );
    await client.query("COMMIT"); open = false;
    return result.rowCount === 1;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/**
 * Binds provider identity independently of the lease. This is deliberately
 * limited to the command's still-pending row: it closes the crash window
 * between provider spawn and the fenced durable activation write.
 */
export async function bindHeadActivationInvocation(
  pool: Pool,
  goalId: string,
  departmentId: string,
  commandId: string,
  executionRef: string,
  invocationRef: string,
): Promise<boolean> {
  if ([goalId, departmentId, commandId, executionRef, invocationRef].some((value) => value.trim() === "")) return false;
  const result = await pool.query(
    `UPDATE head_activation_commands
        SET provider_execution_ref = $4, provider_invocation_ref = $5, updated_at = transaction_timestamp()
      WHERE command_id = $1 AND goal_id = $2 AND department_id = $3
        AND status = 'spawn_started'
        AND provider_execution_ref IS NULL AND provider_invocation_ref IS NULL`,
    [commandId, goalId, departmentId, executionRef, invocationRef],
  );
  return result.rowCount === 1;
}

/** Reset only a spawn that is confirmed to have produced no provider session. */
export async function resetHeadActivationAfterSpawnFailure(
  pool: Pool,
  goalId: string,
  departmentId: string,
  commandId: string,
  proof: GoalLeaseProof,
): Promise<boolean> {
  if (goalId !== proof.goalId || !validProof(proof) || commandId.trim() === "") {
    throw new StaleGoalLeaseError(goalId);
  }
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await assertGoalLeaseOwnership(client, proof);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [goalId]);
    const command = await client.query<{ status: HeadActivationCommandStatus; active_session_ref: string | null }>(
      `SELECT status, active_session_ref FROM head_activation_commands
        WHERE command_id = $1 AND goal_id = $2 AND department_id = $3
        FOR UPDATE`,
      [commandId, goalId, departmentId],
    );
    if (command.rowCount !== 1 || command.rows[0]!.status !== "spawn_started" ||
        command.rows[0]!.active_session_ref !== null) {
      await client.query("COMMIT"); open = false; return false;
    }
    const updated = await client.query(
      `UPDATE head_activation_commands
          SET status = 'reserved', provider_execution_ref = NULL, provider_invocation_ref = NULL,
              active_session_ref = NULL, updated_at = transaction_timestamp()
        WHERE command_id = $1 AND goal_id = $2 AND department_id = $3 AND status = 'spawn_started'
          AND provider_execution_ref IS NULL AND provider_invocation_ref IS NULL`,
      [commandId, goalId, departmentId],
    );
    if (updated.rowCount !== 1) { await client.query("COMMIT"); open = false; return false; }
    await client.query(
      `UPDATE goal_head_participations SET status = 'sleeping', active_session_ref = NULL, updated_at = transaction_timestamp()
        WHERE goal_id = $1 AND department_id = $2 AND status = 'starting'`, [goalId, departmentId],
    );
    await client.query("COMMIT"); open = false; return true;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Reopens a provider-backed reservation only after cancellation was confirmed. */
export async function resetHeadActivationAfterCancellation(
  pool: Pool,
  goalId: string,
  departmentId: string,
  commandId: string,
  proof: GoalLeaseProof,
): Promise<boolean> {
  if (goalId !== proof.goalId || !validProof(proof) || commandId.trim() === "") {
    throw new StaleGoalLeaseError(goalId);
  }
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await assertGoalLeaseOwnership(client, proof);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [goalId]);
    const command = await client.query<{ status: HeadActivationCommandStatus; active_session_ref: string | null }>(
      `SELECT status, active_session_ref FROM head_activation_commands
        WHERE command_id = $1 AND goal_id = $2 AND department_id = $3
        FOR UPDATE`,
      [commandId, goalId, departmentId],
    );
    const prior = command.rows[0];
    if (prior === undefined || !["spawn_started", "orphaned", "active"].includes(prior.status)) {
      await client.query("COMMIT"); open = false; return false;
    }
    const updated = await client.query(
      `UPDATE head_activation_commands
          SET status = 'reserved', provider_execution_ref = NULL, provider_invocation_ref = NULL,
              active_session_ref = NULL, updated_at = transaction_timestamp()
        WHERE command_id = $1 AND goal_id = $2 AND department_id = $3
          AND status IN ('spawn_started', 'orphaned', 'active')`,
      [commandId, goalId, departmentId],
    );
    if (updated.rowCount !== 1) { await client.query("COMMIT"); open = false; return false; }
    if (prior.status === "active") {
      await client.query(
        `UPDATE goal_head_participations SET status = 'sleeping', active_session_ref = NULL, updated_at = transaction_timestamp()
          WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3`,
        [goalId, departmentId, prior.active_session_ref],
      );
    } else {
      await client.query(
        `UPDATE goal_head_participations SET status = 'sleeping', active_session_ref = NULL, updated_at = transaction_timestamp()
          WHERE goal_id = $1 AND department_id = $2 AND status = 'starting'`, [goalId, departmentId],
      );
    }
    await client.query("COMMIT"); open = false; return true;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Mark a provider-backed activation as orphaned when cancellation is not confirmed. */
export async function markHeadActivationOrphaned(
  pool: Pool,
  goalId: string,
  departmentId: string,
  commandId: string,
  proof: GoalLeaseProof,
): Promise<boolean> {
  if (goalId !== proof.goalId || !validProof(proof) || commandId.trim() === "") {
    throw new StaleGoalLeaseError(goalId);
  }
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await assertGoalLeaseOwnership(client, proof);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [goalId]);
    const command = await client.query<{ status: HeadActivationCommandStatus; active_session_ref: string | null }>(
      `SELECT status, active_session_ref FROM head_activation_commands
        WHERE command_id = $1 AND goal_id = $2 AND department_id = $3
        FOR UPDATE`,
      [commandId, goalId, departmentId],
    );
    const prior = command.rows[0];
    if (prior === undefined || !["spawn_started", "active"].includes(prior.status)) {
      await client.query("COMMIT"); open = false; return false;
    }
    const updated = await client.query(
      `UPDATE head_activation_commands
          SET status = 'orphaned', active_session_ref = NULL, updated_at = transaction_timestamp()
        WHERE command_id = $1 AND goal_id = $2 AND department_id = $3
          AND status IN ('spawn_started', 'active')`,
      [commandId, goalId, departmentId],
    );
    if (updated.rowCount !== 1) { await client.query("COMMIT"); open = false; return false; }
    if (prior.status === "active") {
      await client.query(
        `UPDATE goal_head_participations SET status = 'sleeping', active_session_ref = NULL, updated_at = transaction_timestamp()
          WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3`,
        [goalId, departmentId, prior.active_session_ref],
      );
    } else {
      await client.query(
        `UPDATE goal_head_participations SET status = 'sleeping', active_session_ref = NULL, updated_at = transaction_timestamp()
          WHERE goal_id = $1 AND department_id = $2 AND status = 'starting'`, [goalId, departmentId],
      );
    }
    await client.query("COMMIT"); open = false; return true;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** List provider-backed commands that need startup recovery for one Goal. */
export async function listHeadActivationCommandsForRecovery(
  pool: Pool,
  goalId: string,
): Promise<readonly HeadActivationCommandRecoveryRow[]> {
  const result = await pool.query<{
    command_id: string;
    goal_id: string;
    department_id: string;
    status: HeadActivationCommandStatus;
    provider_execution_ref: string | null;
    provider_invocation_ref: string | null;
    active_session_ref: string | null;
  }>(
    `SELECT command_id, goal_id, department_id, status,
            provider_execution_ref, provider_invocation_ref, active_session_ref
       FROM head_activation_commands
      WHERE goal_id = $1
        AND (status IN ('spawn_started', 'active')
          OR (status = 'orphaned' AND provider_execution_ref IS NOT NULL AND provider_invocation_ref IS NOT NULL))
      ORDER BY command_id`,
    [goalId],
  );
  return result.rows.map((row) => ({
    commandId: row.command_id,
    goalId: row.goal_id,
    departmentId: row.department_id,
    status: row.status,
    providerExecutionRef: row.provider_execution_ref,
    providerInvocationRef: row.provider_invocation_ref,
    activeSessionRef: row.active_session_ref,
  }));
}

export async function markHeadParticipationActive(
  pool: Pool,
  goalId: string,
  departmentId: string,
  activeSessionRef: string,
  proof: GoalLeaseProof,
  headRoleId?: string,
  commandId?: string,
): Promise<GoalHeadParticipation> {
  if (goalId !== proof.goalId || !validProof(proof) || activeSessionRef.trim() === "") {
    throw new StaleGoalLeaseError(goalId);
  }
  return mutateParticipation(
    pool,
    goalId,
    departmentId,
    proof,
    `status = 'active', active_session_ref = $3, updated_at = transaction_timestamp()`,
    [activeSessionRef],
    "starting",
    headRoleId,
    activeSessionRef,
    commandId,
  );
}

export async function sleepHeadParticipation(
  pool: Pool,
  goalId: string,
  departmentId: string,
  proof: GoalLeaseProof,
  headRoleId?: string,
): Promise<GoalHeadParticipation> {
  if (goalId !== proof.goalId || !validProof(proof)) throw new StaleGoalLeaseError(goalId);
  return mutateParticipation(
    pool,
    goalId,
    departmentId,
    proof,
    `status = 'sleeping', active_session_ref = NULL, updated_at = transaction_timestamp()`,
    [],
    "active",
    headRoleId,
  );
}

async function mutateParticipation(
  pool: Pool,
  goalId: string,
  departmentId: string,
  proof: GoalLeaseProof,
  set: string,
  extras: readonly string[],
  expected: HeadParticipationStatus,
  requestedHeadRoleId?: string,
  requestedSessionRef?: string,
  activationCommandId?: string,
): Promise<GoalHeadParticipation> {
  if (requestedHeadRoleId !== undefined && requestedHeadRoleId.trim() === "") {
    throw new HeadActivationBindingConflictError("headRoleId must be a non-empty string");
  }
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await assertCurrentGoalLease(client, proof);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [goalId]);
    const rolePredicate = requestedHeadRoleId === undefined ? "" : " AND head_role_id = $3";
    const roleValues = requestedHeadRoleId === undefined
      ? [goalId, departmentId]
      : [goalId, departmentId, requestedHeadRoleId];
    const current = await client.query<ParticipationRow>(
      `SELECT goal_id, department_id, head_role_id, contract_id, context_id, status, active_session_ref
       FROM goal_head_participations
       WHERE goal_id = $1 AND department_id = $2${rolePredicate}
         AND status = '${expected}'
       ORDER BY updated_at DESC, head_role_id
       LIMIT 1 FOR UPDATE`,
      roleValues,
    );
    if (current.rowCount !== 1) {
      if (requestedHeadRoleId !== undefined) {
        throw new HeadActivationBindingConflictError("HeadRoleId is not bound to the requested Goal participation");
      }
      throw new Error(`Head participation is not ${expected}`);
    }
    const participation = current.rows[0]!;
    if (requestedSessionRef !== undefined) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 13))", [participation.head_role_id]);
      // A Head may be active in other Goals; one session still serves one Goal binding.
      const sessionElsewhere = await client.query(
        `SELECT 1 FROM goal_head_participations
         WHERE active_session_ref = $1 AND status = 'active'
           AND (head_role_id <> $2 OR goal_id <> $3)
         LIMIT 1`,
        [requestedSessionRef, participation.head_role_id, goalId],
      );
      if (sessionElsewhere.rowCount === 1) {
        throw new HeadActivationRuntimeConflictError();
      }
    }
    const values = [goalId, participation.head_role_id, ...extras, expected];
    const result = await client.query<ParticipationRow>(
      `UPDATE goal_head_participations SET ${set}
       WHERE goal_id = $1 AND head_role_id = $2 AND status = $${values.length}
       RETURNING goal_id, department_id, head_role_id, contract_id, context_id, status, active_session_ref`,
      values,
    );
    if (result.rowCount !== 1) throw new Error(`Head participation is not ${expected}`);
    if (activationCommandId !== undefined) {
      await client.query(
        `UPDATE head_activation_commands
            SET status = 'active', active_session_ref = $2, updated_at = transaction_timestamp()
          WHERE command_id = $1 AND goal_id = $3 AND department_id = $4 AND status = 'spawn_started'`,
        [activationCommandId, requestedSessionRef, goalId, departmentId],
      );
    }
    await client.query("COMMIT"); open = false; return mapParticipation(result.rows[0]!);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
