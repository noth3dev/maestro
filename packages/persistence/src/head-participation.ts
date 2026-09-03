import { randomUUID } from "node:crypto";
import type { GoalHeadParticipation, HeadParticipationStatus } from "@maestro/domain";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen } from "./council.js";
import type { Pool, PoolClient } from "pg";

export interface ActivateHeadRequest {
  readonly goalId: string;
  readonly departmentId: string;
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
    | { readonly role: "Sane" }
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
  | { readonly role: "Sane" }
  | { readonly role: "Head"; readonly departmentId: string; readonly headRoleId?: string };
type AttemptOutcome = "reserved" | "already_active" | "cycle_rejected" | "runtime_conflict" | "binding_conflict";
type ActivationBrief = {
  readonly requestedContribution: string;
  readonly urgency: string;
  readonly contextScope: readonly string[];
  readonly budgetEffect: string;
};

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
  const requester = request.requester ?? { role: "Sane" as const };
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

export async function markHeadParticipationActive(
  pool: Pool,
  goalId: string,
  departmentId: string,
  activeSessionRef: string,
  proof: GoalLeaseProof,
  headRoleId?: string,
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
    await client.query("COMMIT"); open = false; return mapParticipation(result.rows[0]!);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
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
