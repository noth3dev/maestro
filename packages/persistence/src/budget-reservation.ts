import { randomUUID } from "node:crypto";
import { allocatableCentsAfterQualityReserve, assertValidBudgetReservationSubstance } from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen, isAuthorizedHeadCouncilActor, readHeadCouncil, type CouncilActorContext } from "./council.js";

export class BudgetReservationError extends Error {}
export class BudgetReservationNotFoundError extends BudgetReservationError {}

export interface BudgetReservation {
  readonly reservationId: string;
  readonly scope: "goal" | "department" | "mission";
  readonly goalId: string;
  readonly departmentId: string | null;
  readonly councilId: string | null;
  readonly planVersion: number | null;
  readonly itemId: string | null;
  readonly parentReservationId: string | null;
  readonly amountCents: number;
  readonly reason: string;
  readonly ceoApproved: boolean;
}

interface ReservationRow {
  reservation_id: string; scope: "goal" | "department" | "mission"; goal_id: string;
  department_id: string | null; council_id: string | null; plan_version: number | null; item_id: string | null;
  parent_reservation_id: string | null; amount_cents: string; reason: string; ceo_approved: boolean;
}

function mapReservation(row: ReservationRow): BudgetReservation {
  return {
    reservationId: row.reservation_id, scope: row.scope, goalId: row.goal_id, departmentId: row.department_id,
    councilId: row.council_id, planVersion: row.plan_version, itemId: row.item_id,
    parentReservationId: row.parent_reservation_id, amountCents: Number(row.amount_cents),
    reason: row.reason, ceoApproved: row.ceo_approved,
  };
}

function reservationSelectSql(): string {
  return "SELECT reservation_id, scope, goal_id, department_id, council_id, plan_version, item_id, parent_reservation_id, amount_cents, reason, ceo_approved FROM budget_reservations";
}

async function lockGoalLease(client: PoolClient, proof: GoalLeaseProof): Promise<void> {
  const lease = await client.query("SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint AND expires_at > clock_timestamp() FOR UPDATE", [proof.goalId, proof.ownerId, proof.fencingToken]);
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 19))", [proof.goalId]);
  await assertGoalControlOpen(client, proof.goalId);
}

/** Sets or changes the Goal-level budget envelope. Increasing it beyond the prior amount requires explicit CEO approval; decreasing or setting the first envelope does not. */
export async function reserveGoalBudget(pool: Pool, goalId: string, amountCents: number, reason: string, proof: GoalLeaseProof, context: CouncilActorContext, ceoApproved = false): Promise<BudgetReservation> {
  assertValidBudgetReservationSubstance({ scope: "goal", amountCents, reason });
  if (goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await lockGoalLease(client, proof);
    const prior = await client.query<ReservationRow>(reservationSelectSql() + " WHERE goal_id = $1 AND scope = 'goal' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [goalId]);
    const priorAmount = prior.rowCount === 1 ? Number(prior.rows[0]!.amount_cents) : null;
    if (priorAmount !== null && amountCents > priorAmount && !ceoApproved) {
      throw new BudgetReservationError(`Increasing the Goal budget envelope from ${priorAmount} to ${amountCents} requires CEO approval`);
    }
    const inserted = await client.query<ReservationRow>(
      `INSERT INTO budget_reservations (reservation_id, scope, goal_id, amount_cents, reason, ceo_approved, actor_id, session_ref)
       VALUES ($1, 'goal', $2, $3, $4, $5, $6, $7)
       RETURNING reservation_id, scope, goal_id, department_id, council_id, plan_version, item_id, parent_reservation_id, amount_cents, reason, ceo_approved`,
      [randomUUID(), goalId, amountCents, reason.trim(), priorAmount !== null && amountCents > priorAmount, context.actorId, context.sessionRef],
    );
    await client.query("COMMIT"); open = false;
    return mapReservation(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Carves a Department allocation from the current Goal envelope, bounded by the quality/recovery reserve. Only that Department's currently active, captured Head may allocate it. */
export async function reserveDepartmentBudget(pool: Pool, councilId: string, departmentId: string, amountCents: number, reason: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<BudgetReservation> {
  assertValidBudgetReservationSubstance({ scope: "department", amountCents, reason });
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const council = await readHeadCouncil(pool, councilId);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
    if (captured === undefined) throw new BudgetReservationError("Department is not a captured Council participant");
    const authorized = captured.headRoleId !== undefined
      ? isAuthorizedHeadCouncilActor(context, captured)
      : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
    if (!authorized) throw new BudgetReservationError("Actor is not bound to the captured Head identity and session");
    const goalReservation = await client.query<ReservationRow>(reservationSelectSql() + " WHERE goal_id = $1 AND scope = 'goal' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [council.goalId]);
    if (goalReservation.rowCount !== 1) throw new BudgetReservationError("Goal budget envelope must be reserved before a Department allocation");
    const goalRow = goalReservation.rows[0]!;
    const allocatable = allocatableCentsAfterQualityReserve(Number(goalRow.amount_cents));
    const allocated = await client.query<{ total: string }>(
      "SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM budget_reservations WHERE parent_reservation_id = $1 AND scope = 'department'",
      [goalRow.reservation_id],
    );
    const alreadyAllocated = Number(allocated.rows[0]!.total);
    if (alreadyAllocated + amountCents > allocatable) {
      throw new BudgetReservationError(`Department allocation ${amountCents} exceeds remaining allocatable Goal budget ${allocatable - alreadyAllocated} (quality/recovery reserve protected)`);
    }
    const inserted = await client.query<ReservationRow>(
      `INSERT INTO budget_reservations (reservation_id, scope, goal_id, department_id, council_id, parent_reservation_id, amount_cents, reason, actor_id, session_ref)
       VALUES ($1, 'department', $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING reservation_id, scope, goal_id, department_id, council_id, plan_version, item_id, parent_reservation_id, amount_cents, reason, ceo_approved`,
      [randomUUID(), council.goalId, departmentId, councilId, goalRow.reservation_id, amountCents, reason.trim(), context.actorId, context.sessionRef],
    );
    await client.query("COMMIT"); open = false;
    return mapReservation(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Carves a Mission allocation from the Department's current cumulative allocation. Same Head authorization. */
export async function reserveMissionBudget(pool: Pool, councilId: string, departmentId: string, planVersion: number, itemId: string, amountCents: number, reason: string, proof: GoalLeaseProof, context: CouncilActorContext): Promise<BudgetReservation> {
  assertValidBudgetReservationSubstance({ scope: "mission", amountCents, reason });
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const council = await readHeadCouncil(pool, councilId);
    if (council.goalId !== proof.goalId || proof.goalId === "" || proof.ownerId === "" || !isValidFencingToken(proof.fencingToken)) throw new StaleGoalLeaseError(proof.goalId);
    await lockGoalLease(client, proof);
    const captured = council.snapshot.participants.find((participant) => (participant.departmentId ?? participant.participantId) === departmentId);
    if (captured === undefined) throw new BudgetReservationError("Department is not a captured Council participant");
    const authorized = captured.headRoleId !== undefined
      ? isAuthorizedHeadCouncilActor(context, captured)
      : context.actorId === captured.participantId && context.sessionRef === captured.sessionRef;
    if (!authorized) throw new BudgetReservationError("Actor is not bound to the captured Head identity and session");
    const goalReservation = await client.query<ReservationRow>(reservationSelectSql() + " WHERE goal_id = $1 AND scope = 'goal' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [council.goalId]);
    if (goalReservation.rowCount !== 1) throw new BudgetReservationError("Goal budget envelope must be reserved before a Mission allocation");
    const deptReservation = await client.query<ReservationRow>(
      reservationSelectSql() + " WHERE parent_reservation_id = $1 AND scope = 'department' AND department_id = $2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [goalReservation.rows[0]!.reservation_id, departmentId],
    );
    if (deptReservation.rowCount !== 1) throw new BudgetReservationError("Department budget must be allocated before a Mission allocation");
    const deptRow = deptReservation.rows[0]!;
    const allocated = await client.query<{ total: string }>(
      "SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM budget_reservations WHERE parent_reservation_id = $1 AND scope = 'mission'",
      [deptRow.reservation_id],
    );
    const alreadyAllocated = Number(allocated.rows[0]!.total);
    if (alreadyAllocated + amountCents > Number(deptRow.amount_cents)) {
      throw new BudgetReservationError(`Mission allocation ${amountCents} exceeds remaining Department budget ${Number(deptRow.amount_cents) - alreadyAllocated}`);
    }
    const inserted = await client.query<ReservationRow>(
      `INSERT INTO budget_reservations (reservation_id, scope, goal_id, department_id, council_id, plan_version, item_id, parent_reservation_id, amount_cents, reason, actor_id, session_ref)
       VALUES ($1, 'mission', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING reservation_id, scope, goal_id, department_id, council_id, plan_version, item_id, parent_reservation_id, amount_cents, reason, ceo_approved`,
      [randomUUID(), council.goalId, departmentId, councilId, planVersion, itemId, deptRow.reservation_id, amountCents, reason.trim(), context.actorId, context.sessionRef],
    );
    await client.query("COMMIT"); open = false;
    return mapReservation(inserted.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function readBudgetReservation(pool: Pool, reservationId: string): Promise<BudgetReservation> {
  const result = await pool.query<ReservationRow>(reservationSelectSql() + " WHERE reservation_id = $1", [reservationId]);
  if (result.rowCount !== 1) throw new BudgetReservationNotFoundError(`Budget reservation not found: ${reservationId}`);
  return mapReservation(result.rows[0]!);
}

export interface BudgetForecast {
  readonly forecastId: string;
  readonly reservationId: string;
  readonly milestone: string;
  readonly projectedCents: number;
  readonly confidence: "low" | "medium" | "high";
}

/** A milestone forecast against a reservation; a projection, not a spend. */
export async function recordBudgetForecast(pool: Pool, reservationId: string, milestone: string, projectedCents: number, confidence: "low" | "medium" | "high", context: CouncilActorContext): Promise<BudgetForecast> {
  if (milestone.trim() === "") throw new BudgetReservationError("Budget forecast milestone is required");
  if (!Number.isSafeInteger(projectedCents) || projectedCents < 0) throw new BudgetReservationError("Budget forecast projectedCents must be a nonnegative safe integer");
  const reservation = await pool.query("SELECT 1 FROM budget_reservations WHERE reservation_id = $1", [reservationId]);
  if (reservation.rowCount !== 1) throw new BudgetReservationNotFoundError(`Budget reservation not found: ${reservationId}`);
  const forecastId = randomUUID();
  const inserted = await pool.query<{ forecast_id: string; reservation_id: string; milestone: string; projected_cents: string; confidence: "low" | "medium" | "high" }>(
    `INSERT INTO budget_forecasts (forecast_id, reservation_id, milestone, projected_cents, confidence, actor_id, session_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING forecast_id, reservation_id, milestone, projected_cents, confidence`,
    [forecastId, reservationId, milestone.trim(), projectedCents, confidence, context.actorId, context.sessionRef],
  );
  const row = inserted.rows[0]!;
  return { forecastId: row.forecast_id, reservationId: row.reservation_id, milestone: row.milestone, projectedCents: Number(row.projected_cents), confidence: row.confidence };
}

export async function listBudgetForecasts(pool: Pool, reservationId: string): Promise<readonly BudgetForecast[]> {
  const result = await pool.query<{ forecast_id: string; reservation_id: string; milestone: string; projected_cents: string; confidence: "low" | "medium" | "high" }>(
    "SELECT forecast_id, reservation_id, milestone, projected_cents, confidence FROM budget_forecasts WHERE reservation_id = $1 ORDER BY recorded_at",
    [reservationId],
  );
  return result.rows.map((row) => ({ forecastId: row.forecast_id, reservationId: row.reservation_id, milestone: row.milestone, projectedCents: Number(row.projected_cents), confidence: row.confidence }));
}
