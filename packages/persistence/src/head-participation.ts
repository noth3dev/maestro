import { randomUUID } from "node:crypto";
import type { GoalHeadParticipation, HeadParticipationStatus } from "@maestro/domain";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import type { Pool, PoolClient } from "pg";

export interface ActivateHeadRequest {
  readonly goalId: string;
  readonly departmentId: string;
  /** The selected Task Contract, when one exists. No contract body is copied here. */
  readonly contractId?: string;
  readonly requester?: { readonly role: "Sane" } | { readonly role: "Head"; readonly departmentId: string };
  readonly reason: string;
  readonly evidence?: Record<string, unknown>;
}

export class HeadActivationCycleError extends Error {
  readonly code = "head_activation_cycle";
  constructor() { super("Head activation would create a cycle"); this.name = "HeadActivationCycleError"; }
}
export class HeadActivationRequesterInactiveError extends Error {
  constructor() { super("A Head requester must have an active Goal participation"); this.name = "HeadActivationRequesterInactiveError"; }
}

type ParticipationRow = { goal_id: string; department_id: string; contract_id: string | null; status: HeadParticipationStatus; active_session_ref: string | null };

/**
 * Atomically reserves (or resumes) one Goal-scoped Head. This intentionally
 * performs no provider call: a separate caller may mark the reservation active.
 */
export async function activateHeadParticipation(pool: Pool, request: ActivateHeadRequest, proof: GoalLeaseProof): Promise<GoalHeadParticipation> {
  if (request.goalId !== proof.goalId || !validProof(proof)) throw new StaleGoalLeaseError(request.goalId);
  if (request.departmentId === "" || request.reason === "") throw new RangeError("departmentId and reason are required");
  const requester = request.requester ?? { role: "Sane" as const };
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await assertCurrentGoalLease(client, proof);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [request.goalId]);
    if (requester.role === "Head") await assertActiveRequester(client, request.goalId, requester.departmentId);

    const existing = await client.query<ParticipationRow>(
      "SELECT goal_id, department_id, contract_id, status, active_session_ref FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 FOR UPDATE",
      [request.goalId, request.departmentId],
    );
    const cycle = requester.role === "Head" && await wouldCreateCycle(client, request.goalId, requester.departmentId, request.departmentId);
    if (cycle) {
      // The rejected request is durable audit history, not a rolled-back write.
      await insertAttempt(client, request, requester, "cycle_rejected");
      await client.query("COMMIT"); open = false;
      throw new HeadActivationCycleError();
    }

    let row: ParticipationRow;
    let outcome: "reserved" | "already_active";
    if (existing.rowCount === 1 && existing.rows[0]!.status === "active") {
      row = existing.rows[0]!; outcome = "already_active";
    } else if (existing.rowCount === 1) {
      const updated = await client.query<ParticipationRow>(
        `UPDATE goal_head_participations SET status = 'starting', active_session_ref = NULL,
          contract_id = COALESCE($3::uuid, contract_id), updated_at = transaction_timestamp()
         WHERE goal_id = $1 AND department_id = $2
         RETURNING goal_id, department_id, contract_id, status, active_session_ref`,
        [request.goalId, request.departmentId, request.contractId ?? null],
      );
      row = updated.rows[0]!; outcome = "reserved";
    } else {
      const inserted = await client.query<ParticipationRow>(
        `INSERT INTO goal_head_participations (goal_id, department_id, contract_id, status, active_session_ref)
         VALUES ($1, $2, $3::uuid, 'starting', NULL)
         RETURNING goal_id, department_id, contract_id, status, active_session_ref`,
        [request.goalId, request.departmentId, request.contractId ?? null],
      );
      row = inserted.rows[0]!; outcome = "reserved";
    }
    if (requester.role === "Head") {
      await client.query(`INSERT INTO head_activation_edges (goal_id, requester_department_id, department_id)
        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [request.goalId, requester.departmentId, request.departmentId]);
    }
    await insertAttempt(client, request, requester, outcome);
    await client.query("COMMIT"); open = false;
    return mapParticipation(row);
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function markHeadParticipationActive(pool: Pool, goalId: string, departmentId: string, activeSessionRef: string, proof: GoalLeaseProof): Promise<GoalHeadParticipation> {
  if (goalId !== proof.goalId || !validProof(proof) || activeSessionRef === "") throw new StaleGoalLeaseError(goalId);
  return mutateParticipation(pool, goalId, departmentId, proof, `status = 'active', active_session_ref = $3, updated_at = transaction_timestamp()`, [activeSessionRef], "starting");
}

export async function sleepHeadParticipation(pool: Pool, goalId: string, departmentId: string, proof: GoalLeaseProof): Promise<GoalHeadParticipation> {
  if (goalId !== proof.goalId || !validProof(proof)) throw new StaleGoalLeaseError(goalId);
  return mutateParticipation(pool, goalId, departmentId, proof, `status = 'sleeping', active_session_ref = NULL, updated_at = transaction_timestamp()`, [], "active");
}

async function mutateParticipation(pool: Pool, goalId: string, departmentId: string, proof: GoalLeaseProof, set: string, extras: readonly string[], expected: HeadParticipationStatus): Promise<GoalHeadParticipation> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true; await assertCurrentGoalLease(client, proof);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 12))", [goalId]);
    const values = [goalId, departmentId, ...extras, expected];
    const result = await client.query<ParticipationRow>(`UPDATE goal_head_participations SET ${set} WHERE goal_id = $1 AND department_id = $2 AND status = $${values.length} RETURNING goal_id, department_id, contract_id, status, active_session_ref`, values);
    if (result.rowCount !== 1) throw new Error(`Head participation is not ${expected}`);
    await client.query("COMMIT"); open = false; return mapParticipation(result.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

async function assertCurrentGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const result = await client.query(`SELECT goal_id FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > transaction_timestamp() FOR UPDATE`, [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (result.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
}
async function assertActiveRequester(client: PoolClient, goalId: string, departmentId: string): Promise<void> {
  const result = await client.query("SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND status = 'active' FOR KEY SHARE", [goalId, departmentId]);
  if (result.rowCount !== 1) throw new HeadActivationRequesterInactiveError();
}
async function wouldCreateCycle(client: PoolClient, goalId: string, requester: string, target: string): Promise<boolean> {
  const result = await client.query(`WITH RECURSIVE reachable(department_id) AS (
      SELECT department_id FROM head_activation_edges WHERE goal_id = $1 AND requester_department_id = $2
      UNION
      SELECT e.department_id FROM head_activation_edges e JOIN reachable r ON e.requester_department_id = r.department_id WHERE e.goal_id = $1
    ) SELECT 1 FROM reachable WHERE department_id = $3 LIMIT 1`, [goalId, target, requester]);
  return result.rowCount === 1;
}
async function insertAttempt(client: PoolClient, request: ActivateHeadRequest, requester: { role: "Sane" } | { role: "Head"; departmentId: string }, outcome: "reserved" | "already_active" | "cycle_rejected"): Promise<void> {
  await client.query(`INSERT INTO head_activation_attempts (attempt_id, goal_id, department_id, requester_department_id, requester_role, outcome, reason, evidence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [randomUUID(), request.goalId, request.departmentId, requester.role === "Head" ? requester.departmentId : null, requester.role, outcome, request.reason, JSON.stringify(request.evidence ?? {})]);
}
function mapParticipation(row: ParticipationRow): GoalHeadParticipation { return { goalId: row.goal_id, departmentId: row.department_id, contractId: row.contract_id, status: row.status, activeSessionRef: row.active_session_ref }; }
function validProof(proof: GoalLeaseProof): boolean { return proof.goalId !== "" && proof.ownerId !== "" && isValidFencingToken(proof.fencingToken); }
