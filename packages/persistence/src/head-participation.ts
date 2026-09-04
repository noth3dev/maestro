import { createHash, randomUUID } from "node:crypto";
import type { GoalHeadParticipation, HeadParticipationStatus } from "@maestro/domain";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen } from "./council.js";
import type { Pool, PoolClient } from "pg";

export interface ActivateHeadRequest {
  readonly goalId: string;
  readonly departmentId: string;
  /** Stable API command identity used for replay-safe activation. */
  readonly commandId?: string;
  /** Stable permanent Head identity. The database verifies it maps to departmentId. */
  readonly headRoleId?: string;
  /** The selected Task Contract, when one exists. No contract body is copied here. */
  readonly contractId?: string;
  /** Goal-scoped context identity. Context contents are assembled elsewhere. */
  readonly contextId?: string;
  /** Required bounded Head activation brief fields retained in the audit attempt. */
  readonly requestedContribution: string;
  readonly urgency: string;
  readonly contextScope: readonly string[];
  readonly budgetEffect: string;
  readonly requester?:
    | { readonly role: "Concertmaster" }
    | { readonly role: "Head"; readonly departmentId: string; readonly headRoleId?: string };
  readonly reason: string;
  readonly evidence?: Record<string, unknown>;
}

export class HeadActivationCycleError extends Error {
  readonly code = "head_activation_cycle";
  constructor() { super("Head activation would create a cycle"); this.name = "HeadActivationCycleError"; }
}

export class HeadActivationRequesterInactiveError extends Error {
  readonly code = "head_activation_requester_inactive";
  constructor() { super("A Head requester must have an active Goal participation"); this.name = "HeadActivationRequesterInactiveError"; }
}

export class HeadActivationRuntimeConflictError extends Error {
  readonly code = "head_runtime_conflict";
  constructor() { super("The permanent Head already has an active runtime binding"); this.name = "HeadActivationRuntimeConflictError"; }
}

export class HeadActivationBindingConflictError extends Error {
  readonly code = "head_activation_binding_conflict";
  constructor(message = "Head activation binding does not match the existing Goal participation") {
    super(message);
    this.name = "HeadActivationBindingConflictError";
  }
}

// Keep the shorter name available to callers that treat the binding as a
// validation error rather than a conflict response.
export { HeadActivationBindingConflictError as HeadActivationBindingError };

type ParticipationRow = {
  goal_id: string;
  department_id: string;
  head_role_id: string;
  contract_id: string | null;
  context_id: string | null;
  status: HeadParticipationStatus;
  active_session_ref: string | null;
};
type HeadRequester =
  | { readonly role: "Concertmaster" }
  | { readonly role: "Head"; readonly departmentId: string; readonly headRoleId?: string };
export type HeadActivationCommandStatus = "reserved" | "spawn_started" | "active" | "orphaned";
export interface HeadActivationCommandRecoveryRow {
  commandId: string;
  goalId: string;
  departmentId: string;
  status: HeadActivationCommandStatus;
  providerExecutionRef: string | null;
  providerInvocationRef: string | null;
  activeSessionRef: string | null;
}
type AttemptOutcome = "reserved" | "already_active" | "cycle_rejected" | "runtime_conflict" | "binding_conflict";
type ActivationBrief = {
  readonly requestedContribution: string;
  readonly urgency: string;
  readonly contextScope: readonly string[];
  readonly budgetEffect: string;
};

function activationRequestHash(request: ActivateHeadRequest, targetHeadRoleId: string): string {
  return createHash("sha256").update(JSON.stringify({
    goalId: request.goalId, departmentId: request.departmentId, headRoleId: targetHeadRoleId,
    contractId: request.contractId ?? null, contextId: request.contextId ?? null,
    requestedContribution: request.requestedContribution, urgency: request.urgency,
    contextScope: request.contextScope, budgetEffect: request.budgetEffect,
    requester: request.requester ?? { role: "Concertmaster" }, reason: request.reason,
    evidence: request.evidence ?? {},
  })).digest("hex");
}

/**
 * Atomically reserves (or resumes) one Goal-scoped Head. This intentionally
 * performs no provider call: a separate caller may mark the reservation active.
 */
export async function activateHeadParticipation(
  pool: Pool,
  request: ActivateHeadRequest,
  proof: GoalLeaseProof,
): Promise<GoalHeadParticipation> {
  if (request.goalId !== proof.goalId || !validProof(proof)) throw new StaleGoalLeaseError(request.goalId);
  assertActivationRequest(request);
  const requester = request.requester ?? { role: "Concertmaster" as const };
  const requestedContractId = request.contractId;
  const requestedContextId = request.contextId;
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await assertCurrentGoalLease(client, proof);
    // Serialize all participation changes for a Goal, then all runtime changes
    // for its stable Head role. The lock order is always Goal -> Head role.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [request.goalId]);

    const targetHeadRoleId = await resolveHeadRole(client, request.departmentId, request.headRoleId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 13))", [targetHeadRoleId]);
    const requesterHeadRoleId = requester.role === "Head"
      ? await resolveHeadRole(client, requester.departmentId, requester.headRoleId)
      : null;
    if (requester.role === "Head") {
      await assertActiveRequester(client, request.goalId, requester.departmentId, requesterHeadRoleId!);
    }
    if (requestedContractId !== undefined) await assertLaunchedContract(client, requestedContractId);

    let commandStatus: HeadActivationCommandStatus | undefined;
    if (request.commandId !== undefined) {
      const requestHash = activationRequestHash(request, targetHeadRoleId);
      const insertedCommand = await client.query<{ status: "reserved" | "spawn_started" | "active" }>(
        `INSERT INTO head_activation_commands (command_id, goal_id, department_id, request_hash, status)
         VALUES ($1, $2, $3, $4, 'reserved') ON CONFLICT (command_id) DO NOTHING RETURNING status`,
        [request.commandId, request.goalId, request.departmentId, requestHash],
      );
      if (insertedCommand.rowCount === 1) commandStatus = "reserved";
      else {
        const priorCommand = await client.query<{ goal_id: string; department_id: string; request_hash: string; status: HeadActivationCommandStatus }>(
          `SELECT goal_id, department_id, request_hash, status FROM head_activation_commands WHERE command_id = $1 FOR UPDATE`, [request.commandId],
        );
        const prior = priorCommand.rows[0];
        if (prior === undefined || prior.goal_id !== request.goalId || prior.department_id !== request.departmentId || prior.request_hash.trim() !== requestHash) {
          throw new HeadActivationBindingConflictError("Head activation command identity was reused with different content");
        }
        commandStatus = prior.status;
      }
    }

    const existing = await client.query<ParticipationRow>(
      `SELECT goal_id, department_id, head_role_id, contract_id, context_id, status, active_session_ref
       FROM goal_head_participations
       WHERE goal_id = $1 AND department_id = $2
       ORDER BY (status = 'active') DESC, updated_at DESC, head_role_id
       FOR UPDATE`,
      [request.goalId, request.departmentId],
    );
    const active = existing.rows.find((candidate) => candidate.status === "active");
    if (active !== undefined && active.head_role_id !== targetHeadRoleId) {
      await insertAttempt(client, request, requester, targetHeadRoleId, requesterHeadRoleId, "binding_conflict");
      await client.query("COMMIT"); open = false;
      throw new HeadActivationBindingConflictError("A different HeadRoleId is already active for this Department and Goal");
    }
    const current = existing.rows.find((candidate) => candidate.head_role_id === targetHeadRoleId);
    if (current?.status !== "active") {
      const orphaned = await client.query(
        `SELECT 1 FROM head_activation_commands
          WHERE goal_id = $1 AND department_id = $2 AND status = 'orphaned'
            AND provider_execution_ref IS NOT NULL
            AND ($3::uuid IS NULL OR command_id <> $3::uuid)
          LIMIT 1 FOR UPDATE`,
        [request.goalId, request.departmentId, request.commandId ?? null],
      );
      if (orphaned.rowCount !== 0) {
        throw new HeadActivationBindingConflictError("Head activation has an unresolved orphaned provider session");
      }
    }
    if (request.commandId !== undefined && current?.status === "starting") {
      const inFlight = await client.query<{ command_id: string }>(
        `SELECT command_id FROM head_activation_commands
          WHERE goal_id = $1 AND department_id = $2 AND status IN ('reserved', 'spawn_started')
            AND command_id <> $3 FOR UPDATE`,
        [request.goalId, request.departmentId, request.commandId],
      );
      if (inFlight.rowCount !== 0) throw new HeadActivationBindingConflictError("Head activation is already in progress");
    }

    const activeElsewhere = await client.query(
      `SELECT 1 FROM goal_head_participations
       WHERE head_role_id = $1 AND status = 'active' AND goal_id <> $2
       LIMIT 1`,
      [targetHeadRoleId, request.goalId],
    );
    if (activeElsewhere.rowCount === 1) {
      await insertAttempt(client, request, requester, targetHeadRoleId, requesterHeadRoleId, "runtime_conflict");
      await client.query("COMMIT"); open = false;
      throw new HeadActivationRuntimeConflictError();
    }

    if (current && bindingMismatch(current, requestedContractId, requestedContextId)) {
      await insertAttempt(client, request, requester, targetHeadRoleId, requesterHeadRoleId, "binding_conflict");
      await client.query("COMMIT"); open = false;
      throw new HeadActivationBindingConflictError();
    }

    // The graph check must test reachability of the requested target, not the
    // requester. This catches both self-edges and transitive cycles.
    const cycle = requester.role === "Head" && (
      requesterHeadRoleId === targetHeadRoleId ||
      await wouldCreateCycle(client, request.goalId, targetHeadRoleId, requesterHeadRoleId!)
    );
    if (cycle) {
      // The rejected request is durable audit history, not a rolled-back write.
      await insertAttempt(client, request, requester, targetHeadRoleId, requesterHeadRoleId, "cycle_rejected");
      await client.query("COMMIT"); open = false;
      throw new HeadActivationCycleError();
    }

    let row: ParticipationRow;
    let outcome: "reserved" | "already_active";
    if (current?.status === "active") {
      row = current;
      outcome = "already_active";
    } else if (current && request.commandId !== undefined && commandStatus !== "reserved") {
      row = current;
      outcome = "reserved";
    } else if (current) {
      const updated = await client.query<ParticipationRow>(
        `UPDATE goal_head_participations
         SET status = 'starting', active_session_ref = NULL,
             contract_id = COALESCE($3::uuid, contract_id),
             context_id = COALESCE($4, context_id),
             updated_at = transaction_timestamp()
         WHERE goal_id = $1 AND head_role_id = $2
         RETURNING goal_id, department_id, head_role_id, contract_id, context_id, status, active_session_ref`,
        [request.goalId, targetHeadRoleId, requestedContractId ?? null, requestedContextId ?? null],
      );
      row = updated.rows[0]!;
      outcome = "reserved";
    } else {
      const inserted = await client.query<ParticipationRow>(
        `INSERT INTO goal_head_participations
           (goal_id, department_id, head_role_id, contract_id, context_id, status, active_session_ref)
         VALUES ($1, $2, $3, $4::uuid, $5, 'starting', NULL)
         RETURNING goal_id, department_id, head_role_id, contract_id, context_id, status, active_session_ref`,
        [request.goalId, request.departmentId, targetHeadRoleId, requestedContractId ?? null, requestedContextId ?? null],
      );
      row = inserted.rows[0]!;
      outcome = "reserved";
    }

    if (request.commandId !== undefined && row.status === "active") {
      await client.query(
        `UPDATE head_activation_commands SET status = 'active', active_session_ref = $2, updated_at = transaction_timestamp()
          WHERE command_id = $1`, [request.commandId, row.active_session_ref],
      );
    }
    if (requester.role === "Head") {
      await client.query(
        `INSERT INTO head_activation_edges
          (goal_id, requester_department_id, department_id, requester_head_role_id, head_role_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [request.goalId, requester.departmentId, request.departmentId, requesterHeadRoleId, targetHeadRoleId],
      );
    }
    await insertAttempt(client, request, requester, targetHeadRoleId, requesterHeadRoleId, outcome);
    await client.query("COMMIT"); open = false;
    return mapParticipation(row);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

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
      const activeElsewhere = await client.query(
        `SELECT 1 FROM goal_head_participations
         WHERE head_role_id = $1 AND status = 'active' AND goal_id <> $2
         LIMIT 1`,
        [participation.head_role_id, goalId],
      );
      const sessionElsewhere = await client.query(
        `SELECT 1 FROM goal_head_participations
         WHERE active_session_ref = $1 AND status = 'active'
           AND (head_role_id <> $2 OR goal_id <> $3)
         LIMIT 1`,
        [requestedSessionRef, participation.head_role_id, goalId],
      );
      if (activeElsewhere.rowCount === 1 || sessionElsewhere.rowCount === 1) {
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

async function assertGoalLeaseOwnership(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const result = await client.query(
    `SELECT goal_id FROM goal_leases
     WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint
       AND expires_at > transaction_timestamp()
     FOR UPDATE`,
    [proof.goalId, proof.ownerId, proof.fencingToken],
  );
  if (result.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
}

async function assertCurrentGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const result = await client.query(
    `SELECT goal_id FROM goal_leases
     WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint
       AND expires_at > transaction_timestamp()
     FOR UPDATE`,
    [proof.goalId, proof.ownerId, proof.fencingToken],
  );
  if (result.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  // A valid lease alone does not authorize Head participation writes once the
  // Goal is paused, stopping, stopped, or emergency-stopped -- matches the
  // Council/DepartmentPlan/Worker call sites' existing control-latch check.
  await assertGoalControlOpen(client, proof.goalId);
}

async function assertActiveRequester(client: PoolClient, goalId: string, departmentId: string, headRoleId: string): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM goal_head_participations
     WHERE goal_id = $1 AND department_id = $2 AND head_role_id = $3 AND status = 'active'
     FOR KEY SHARE`,
    [goalId, departmentId, headRoleId],
  );
  if (result.rowCount !== 1) throw new HeadActivationRequesterInactiveError();
}

async function resolveHeadRole(client: PoolClient, departmentId: string, requestedHeadRoleId?: string): Promise<string> {
  const result = await client.query<{ head_role_id: string }>(
    "SELECT head_role_id FROM permanent_head_roles WHERE department_id = $1",
    [departmentId],
  );
  if (result.rowCount !== 1) throw new HeadActivationBindingConflictError("No permanent Head role is bound to this Department");
  const headRoleId = result.rows[0]!.head_role_id.trim();
  if (headRoleId === "" || (requestedHeadRoleId !== undefined && requestedHeadRoleId !== headRoleId)) {
    throw new HeadActivationBindingConflictError("HeadRoleId is not bound to the requested Department");
  }
  return headRoleId;
}

async function assertLaunchedContract(client: PoolClient, contractId: string): Promise<void> {
  if (!isUuid(contractId)) throw new HeadActivationBindingConflictError("contractId must be a UUID");
  const result = await client.query(
    "SELECT 1 FROM task_contracts WHERE contract_id = $1 AND launch_state = 'launched'",
    [contractId],
  );
  if (result.rowCount !== 1) throw new HeadActivationBindingConflictError("Head activation requires the exact launched Task Contract");
}

function bindingMismatch(
  current: ParticipationRow,
  requestedContractId: string | undefined,
  requestedContextId: string | undefined,
): boolean {
  const active = current.status === "active";
  return (requestedContractId !== undefined &&
      (current.contract_id === null ? active : requestedContractId !== current.contract_id)) ||
    (requestedContextId !== undefined &&
      (current.context_id === null ? active : requestedContextId !== current.context_id));
}

async function wouldCreateCycle(
  client: PoolClient,
  goalId: string,
  targetHeadRoleId: string,
  requesterHeadRoleId: string,
): Promise<boolean> {
  const result = await client.query(
    `WITH RECURSIVE reachable(head_role_id) AS (
       SELECT head_role_id FROM head_activation_edges
       WHERE goal_id = $1 AND requester_head_role_id = $2
       UNION
       SELECT e.head_role_id FROM head_activation_edges e
       JOIN reachable r ON e.requester_head_role_id = r.head_role_id
       WHERE e.goal_id = $1
     )
     SELECT 1 FROM reachable WHERE head_role_id = $3 LIMIT 1`,
    [goalId, targetHeadRoleId, requesterHeadRoleId],
  );
  return result.rowCount === 1;
}

async function insertAttempt(
  client: PoolClient,
  request: ActivateHeadRequest,
  requester: HeadRequester,
  targetHeadRoleId: string,
  requesterHeadRoleId: string | null,
  outcome: AttemptOutcome,
): Promise<void> {
  const brief = activationBrief(request);
  await client.query(
    `INSERT INTO head_activation_attempts
      (attempt_id, goal_id, department_id, head_role_id, requester_department_id,
       requester_head_role_id, requester_role, outcome, reason, evidence,
       requested_contribution, urgency, context_scope, budget_effect)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, $14)`,
    [
      randomUUID(), request.goalId, request.departmentId, targetHeadRoleId,
      requester.role === "Head" ? requester.departmentId : null,
      requesterHeadRoleId, requester.role, outcome, request.reason,
      JSON.stringify(request.evidence ?? {}), brief.requestedContribution,
      brief.urgency, JSON.stringify(brief.contextScope), brief.budgetEffect,
    ],
  );
}

function mapParticipation(row: ParticipationRow): GoalHeadParticipation {
  return {
    goalId: row.goal_id,
    departmentId: row.department_id,
    headRoleId: row.head_role_id,
    contractId: row.contract_id,
    contextId: row.context_id,
    status: row.status,
    activeSessionRef: row.active_session_ref,
  };
}

function assertActivationRequest(request: ActivateHeadRequest): void {
  if (typeof request.departmentId !== "string" || request.departmentId.trim() === "" ||
      typeof request.reason !== "string" || request.reason.trim() === "") {
    throw new RangeError("departmentId and reason are required");
  }
  for (const [name, value] of [
    ["headRoleId", request.headRoleId],
    ["contractId", request.contractId],
    ["contextId", request.contextId],
    ["requestedContribution", request.requestedContribution],
    ["urgency", request.urgency],
    ["budgetEffect", request.budgetEffect],
  ] as const) {
    if (value === undefined && ["requestedContribution", "urgency", "budgetEffect"].includes(name)) {
      throw new RangeError(`${name} is required`);
    }
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
      throw new RangeError(`${name} must be a non-empty string`);
    }
  }
  if (request.contextScope === undefined) throw new RangeError("contextScope is required");
  if (!Array.isArray(request.contextScope) || request.contextScope.length === 0 ||
      request.contextScope.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new RangeError("contextScope must contain non-empty values");
  }
  const requester = request.requester;
  if (requester?.role === "Head") {
    if (typeof requester.departmentId !== "string" || requester.departmentId.trim() === "") {
      throw new RangeError("requester departmentId is required");
    }
    if (requester.headRoleId !== undefined &&
        (typeof requester.headRoleId !== "string" || requester.headRoleId.trim() === "")) {
      throw new RangeError("requester headRoleId must be a non-empty string");
    }
  }
}

function activationBrief(request: ActivateHeadRequest): ActivationBrief {
  return {
    requestedContribution: request.requestedContribution,
    urgency: request.urgency,
    contextScope: request.contextScope,
    budgetEffect: request.budgetEffect,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validProof(proof: GoalLeaseProof): boolean {
  return proof.goalId !== "" && proof.ownerId !== "" && isValidFencingToken(proof.fencingToken);
}
