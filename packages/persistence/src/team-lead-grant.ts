import { randomUUID } from "node:crypto";
import {
  assertValidTeamLeadGrantSubstance,
  type ExecutionKernelPort,
  type ExecutionRef,
  type TeamLeadGrantSubstance,
  type Worker,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "./council.js";
import { WorkerNotFoundError } from "./worker.js";

export class TeamLeadGrantError extends Error {}
export class TeamLeadGrantNotFoundError extends TeamLeadGrantError {}

export interface TeamLeadGrant {
  readonly grantId: string;
  readonly workerId: string;
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly itemId: string;
  readonly substance: TeamLeadGrantSubstance;
  readonly revoked: boolean;
}

interface GrantRow {
  grant_id: string;
  worker_id: string;
  council_id: string;
  department_id: string;
  plan_version: number;
  item_id: string;
  reason: string;
  max_helpers: number;
  cost_ceiling: string;
  duration_ceiling: string;
  task_scope: string;
  reporting_requirement: string;
  granted_at: Date;
  revoked_at: Date | null;
}

interface WorkerIdentityRow {
  council_id: string;
  department_id: string;
  plan_version: number;
  item_id: string;
  execution_ref: string;
  status: string;
  parent_worker_id: string | null;
}

function mapGrant(row: GrantRow): TeamLeadGrant {
  return {
    grantId: row.grant_id,
    workerId: row.worker_id,
    councilId: row.council_id,
    departmentId: row.department_id,
    planVersion: row.plan_version,
    itemId: row.item_id,
    substance: {
      reason: row.reason, maxHelpers: row.max_helpers, costCeiling: row.cost_ceiling,
      durationCeiling: row.duration_ceiling, taskScope: row.task_scope, reportingRequirement: row.reporting_requirement,
    },
    revoked: row.revoked_at !== null,
  };
}

function grantSelectSql(): string {
  return "SELECT grant_id, worker_id, council_id, department_id, plan_version, item_id, reason, max_helpers, cost_ceiling, duration_ceiling, task_scope, reporting_requirement, granted_at, revoked_at FROM team_lead_grants";
}

/**
 * `durationCeiling` is a free-text string (e.g. "1 day") -- there is no
 * domain-wide unit system for it. This parser recognizes the documented
 * "<number> <unit>" convention already used by every grant substance in
 * this codebase and returns `null` when the ceiling does not match it, in
 * which case it is not machine-enforceable and spawnHelperWorker does not
 * claim to enforce it (fails open on genuinely free-form text, never
 * fabricates a violation it cannot prove).
 *
 * Cost ceiling enforcement is deliberately out of scope for this fix: this
 * codebase has no actual or estimated per-helper cost model, so a
 * "<number> <unit>" free-text costCeiling cannot be truthfully enforced as
 * a monetary ceiling (a prior candidate that charged an invented "one unit
 * per helper" against it was reviewed and rejected for exactly this
 * reason). Defining a real cost accounting source/unit is a separate,
 * still-open decision.
 */
const DURATION_UNIT_MS: Record<string, number> = {
  millisecond: 1, second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
};

function parseDurationMs(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(millisecond|second|minute|hour|day)s?\b/i.exec(text);
  if (match === null) return null;
  const amount = Number(match[1]);
  const unitMs = DURATION_UNIT_MS[match[2]!.toLowerCase()];
  if (!Number.isFinite(amount) || unitMs === undefined) return null;
  return amount * unitMs;
}

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 17))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

async function assertAuthorizedHeadForDepartment(pool: Pool, councilId: string, departmentId: string, context: CouncilActorContext, client: PoolClient): Promise<void> {
  const council = await readHeadCouncil(pool, councilId);
  const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
  if (captured === undefined) throw new TeamLeadGrantError("Department is not a captured Council participant");
  const authorized = captured.headRoleId !== undefined
    ? isAuthorizedHeadCouncilActor(context, captured)
    : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
  if (!authorized) throw new TeamLeadGrantError("Actor is not bound to the captured Head identity and session");
  const active = await client.query(
    "SELECT 1 FROM goal_head_participations WHERE goal_id = $1 AND department_id = $2 AND status = 'active' AND active_session_ref = $3 FOR UPDATE",
    [council.goalId, departmentId, captured.sessionRef],
  );
  if (active.rowCount !== 1) throw new TeamLeadGrantError("Captured Head session is no longer authorized");
}

/**
 * A Head designates one of its own currently non-terminal, non-helper
 * workers as a bounded team lead for a large mission. Unbounded recursive
 * spawning is forbidden: a worker that is itself a helper under another
 * grant may never receive its own grant.
 */
export async function grantTeamLead(pool: Pool, workerId: string, substance: TeamLeadGrantSubstance, proof: GoalLeaseProof, context: CouncilActorContext): Promise<TeamLeadGrant> {
  assertValidTeamLeadGrantSubstance(substance);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const workerRow = await client.query<WorkerIdentityRow>(
      "SELECT council_id, department_id, plan_version, item_id, execution_ref, status, parent_worker_id FROM workers WHERE worker_id = $1 FOR UPDATE",
      [workerId],
    );
    if (workerRow.rowCount !== 1) throw new WorkerNotFoundError(`Worker not found: ${workerId}`);
    const worker = workerRow.rows[0]!;
    if (worker.parent_worker_id !== null) throw new TeamLeadGrantError("A helper worker cannot itself receive a team-lead grant");
    if (worker.status === "succeeded" || worker.status === "failed" || worker.status === "cancelled") throw new TeamLeadGrantError("Cannot grant team lead to a terminal worker");
    await lockGoalLease(client, proof);
    await assertAuthorizedHeadForDepartment(pool, worker.council_id, worker.department_id, context, client);
    const existing = await client.query<GrantRow>(grantSelectSql() + " WHERE worker_id = $1 AND revoked_at IS NULL", [workerId]);
    if ((existing.rowCount ?? 0) > 0) throw new TeamLeadGrantError("Worker already has an active team-lead grant");
    const inserted = await client.query<GrantRow>(
      `INSERT INTO team_lead_grants (grant_id, worker_id, council_id, department_id, plan_version, item_id, reason, max_helpers, cost_ceiling, duration_ceiling, task_scope, reporting_requirement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING grant_id, worker_id, council_id, department_id, plan_version, item_id, reason, max_helpers, cost_ceiling, duration_ceiling, task_scope, reporting_requirement, revoked_at`,
      [randomUUID(), workerId, worker.council_id, worker.department_id, worker.plan_version, worker.item_id, substance.reason, substance.maxHelpers, substance.costCeiling, substance.durationCeiling, substance.taskScope, substance.reportingRequirement],
    );
    await client.query("COMMIT"); open = false;
    return mapGrant(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function readTeamLeadGrant(pool: Pool, grantId: string): Promise<TeamLeadGrant> {
  const result = await pool.query<GrantRow>(grantSelectSql() + " WHERE grant_id = $1", [grantId]);
  if (result.rowCount !== 1) throw new TeamLeadGrantNotFoundError(`Team-lead grant not found: ${grantId}`);
  return mapGrant(result.rows[0]!);
}

/** Revocation is the grant's only allowed mutation; it is immediate and immutable once applied. */
export async function revokeTeamLeadGrant(pool: Pool, grantId: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<TeamLeadGrant> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const current = await client.query<GrantRow>(grantSelectSql() + " WHERE grant_id = $1 FOR UPDATE", [grantId]);
    if (current.rowCount !== 1) throw new TeamLeadGrantNotFoundError(`Team-lead grant not found: ${grantId}`);
    const grant = current.rows[0]!;
    if (grant.revoked_at !== null) { await client.query("COMMIT"); open = false; return mapGrant(grant); }
    await lockGoalLease(client, proof);
    await assertAuthorizedHeadForDepartment(pool, grant.council_id, grant.department_id, context, client);
    const updated = await client.query<GrantRow>(
      `UPDATE team_lead_grants SET revoked_at = transaction_timestamp() WHERE grant_id = $1
       RETURNING grant_id, worker_id, council_id, department_id, plan_version, item_id, reason, max_helpers, cost_ceiling, duration_ceiling, task_scope, reporting_requirement, revoked_at`,
      [grantId],
    );
    await client.query("COMMIT"); open = false;
    return mapGrant(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/**
 * Spawns one helper worker under an active, unrevoked grant, bounded by
 * three of its four grant ceilings: maxHelpers (helper count), durationCeiling
 * (parsed "<number> <unit>" elapsed time since the grant was issued), and
 * the grant's task scope (the exact Department Plan version it was issued
 * against -- a later plan revision supersedes the grant's scope). costCeiling
 * enforcement is deliberately out of scope (see parseDurationMs's doc
 * comment). The helper is parented to the team lead's own execution (Prime's
 * native hierarchy) and remains visible under the same Department Plan
 * mission.
 */
export async function spawnHelperWorker(pool: Pool, kernel: ExecutionKernelPort, grantId: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<Worker> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const grantRow = await client.query<GrantRow>(grantSelectSql() + " WHERE grant_id = $1 FOR UPDATE", [grantId]);
    if (grantRow.rowCount !== 1) throw new TeamLeadGrantNotFoundError(`Team-lead grant not found: ${grantId}`);
    const grant = grantRow.rows[0]!;
    if (grant.revoked_at !== null) throw new TeamLeadGrantError("Team-lead grant is revoked");
    await lockGoalLease(client, proof);
    await assertAuthorizedHeadForDepartment(pool, grant.council_id, grant.department_id, context, client);
    const teamLead = await client.query<WorkerIdentityRow & { worker_id: string }>(
      "SELECT worker_id, council_id, department_id, plan_version, item_id, execution_ref, status, parent_worker_id FROM workers WHERE worker_id = $1 FOR UPDATE",
      [grant.worker_id],
    );
    if (teamLead.rowCount !== 1) throw new WorkerNotFoundError(`Team-lead worker not found: ${grant.worker_id}`);
    const durationMs = parseDurationMs(grant.duration_ceiling);
    if (durationMs !== null && Date.now() - grant.granted_at.getTime() > durationMs) {
      throw new TeamLeadGrantError(`Team-lead grant duration ceiling exceeded: ${grant.duration_ceiling}`);
    }
    const currentPlan = await client.query<{ current_version: number }>(
      "SELECT current_version FROM department_plans WHERE council_id = $1 AND department_id = $2",
      [grant.council_id, grant.department_id],
    );
    if (currentPlan.rowCount === 1 && currentPlan.rows[0]!.current_version !== grant.plan_version) {
      throw new TeamLeadGrantError(`Team-lead grant task scope ceiling exceeded: mission plan was revised from version ${grant.plan_version} to ${currentPlan.rows[0]!.current_version}`);
    }
    const helperCount = await client.query<{ count: string }>("SELECT count(*)::int AS count FROM workers WHERE grant_id = $1", [grantId]);
    const nextHelperNumber = Number(helperCount.rows[0]!.count) + 1;
    if (Number(helperCount.rows[0]!.count) >= grant.max_helpers) throw new TeamLeadGrantError(`Team-lead grant helper ceiling reached: ${grant.max_helpers}`);
    const spawned = await kernel.spawn({ name: `helper:${grant.item_id}:${nextHelperNumber}`, parent: teamLead.rows[0]!.execution_ref as unknown as ExecutionRef });
    const workerId = randomUUID();
    const helperAttempt = nextHelperNumber;
    const inserted = await client.query<{
      worker_id: string; council_id: string; department_id: string; plan_version: number; item_id: string;
      bundle_content_hash: string; attempt: number; execution_ref: string; invocation_ref: string; status: string;
      answer_text: string | null; usage_total_tokens: number | null;
    }>(
      `INSERT INTO workers (worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, parent_worker_id, grant_id)
       SELECT $1, council_id, department_id, plan_version, item_id, bundle_content_hash, $2, $3, $4, 'spawned', $5, $6
       FROM workers w1 WHERE worker_id = $7
       RETURNING worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, answer_text, usage_total_tokens`,
      [workerId, helperAttempt, spawned.execution, spawned.invocation, grant.worker_id, grantId, grant.worker_id],
    );
    await client.query("COMMIT"); open = false;
    const row = inserted.rows[0]!;
    return {
      workerId: row.worker_id, councilId: row.council_id, departmentId: row.department_id, planVersion: row.plan_version,
      itemId: row.item_id, bundleContentHash: row.bundle_content_hash.trim(), attempt: row.attempt,
      executionRef: row.execution_ref, invocationRef: row.invocation_ref, status: row.status as Worker["status"],
      answerText: row.answer_text, usageTotalTokens: row.usage_total_tokens,
    };
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
