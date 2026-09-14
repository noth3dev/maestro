import { randomUUID } from "node:crypto";
import { capacityDemand, type CapacityDemand } from "@maestro/domain";
import type { Pool } from "pg";

export class CapacityReservationError extends Error {
  constructor(message: string) { super(message); this.name = "CapacityReservationError"; }
}
export interface CapacityInventoryInput { readonly projectId: string; readonly providerRate: number; readonly spendCents: number; readonly workerSlots: number; readonly providerRateFloor?: number; readonly spendCentsFloor?: number; readonly workerSlotsFloor?: number; }
export interface PersistedCapacityReservation extends CapacityDemand { readonly reservationId: string; readonly status: "reserved" | "queued" | "released"; readonly queuedAt: number; readonly createdAt: Date; readonly releasedAt?: Date; readonly queueReason?: "provider_rate" | "spend_cents" | "worker_slots"; }
export type PersistedCapacityAdmission =
  | { readonly kind: "reserved"; readonly reservation: PersistedCapacityReservation }
  | { readonly kind: "queued"; readonly reason: "provider_rate" | "spend_cents" | "worker_slots"; readonly demand: CapacityDemand; readonly reservationId: string }
  | { readonly kind: "replayed"; readonly reservation: PersistedCapacityReservation };

type ReservationRow = {
  reservation_id: string; project_id: string; goal_id: string; command_id: string;
  provider_rate: number; spend_cents: string; worker_slots: number;
  requirement: CapacityDemand["requirement"]; pressure: CapacityDemand["pressure"];
  status: "reserved" | "queued" | "released"; queue_reason: "provider_rate" | "spend_cents" | "worker_slots" | null;
  created_at: Date; released_at: Date | null; demand_snapshot: CapacityDemand; actor_id: string | null; session_ref: string | null; fencing_token: string | null;
};
function map(row: ReservationRow): PersistedCapacityReservation {
  return { ...row.demand_snapshot, reservationId: row.reservation_id, status: row.status, queuedAt: row.created_at.getTime(), createdAt: row.created_at, ...(row.released_at === null ? {} : { releasedAt: row.released_at }), ...(row.queue_reason === null ? {} : { queueReason: row.queue_reason }) };
}
function validateInventory(input: CapacityInventoryInput): void {
  if (!input.projectId.trim()) throw new CapacityReservationError("Capacity inventory projectId is required");
  for (const [key, value] of [["providerRate", input.providerRate], ["spendCents", input.spendCents], ["workerSlots", input.workerSlots]] as const) {
    if (!Number.isSafeInteger(value) || value < 0) throw new CapacityReservationError(`${key} must be a nonnegative safe integer`);
  }
}
export async function upsertCapacityInventory(pool: Pool, input: CapacityInventoryInput): Promise<void> {
  validateInventory(input);
  await pool.query(`INSERT INTO capacity_inventories (project_id, provider_rate, provider_rate_floor, spend_cents, spend_cents_floor, worker_slots, worker_slots_floor) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (project_id) DO UPDATE SET provider_rate = EXCLUDED.provider_rate, provider_rate_floor = EXCLUDED.provider_rate_floor, spend_cents = EXCLUDED.spend_cents, spend_cents_floor = EXCLUDED.spend_cents_floor, worker_slots = EXCLUDED.worker_slots, worker_slots_floor = EXCLUDED.worker_slots_floor, updated_at = transaction_timestamp()`, [input.projectId, input.providerRate, input.providerRateFloor ?? 0, input.spendCents, input.spendCentsFloor ?? 0, input.workerSlots, input.workerSlotsFloor ?? 0]);
}
export async function ensureCapacityInventory(pool: Pool, input: CapacityInventoryInput): Promise<void> {
  validateInventory(input);
  await pool.query(`INSERT INTO capacity_inventories (project_id, provider_rate, provider_rate_floor, spend_cents, spend_cents_floor, worker_slots, worker_slots_floor) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (project_id) DO NOTHING`, [input.projectId, input.providerRate, input.providerRateFloor ?? 0, input.spendCents, input.spendCentsFloor ?? 0, input.workerSlots, input.workerSlotsFloor ?? 0]);
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function demandMatches(row: ReservationRow, demand: CapacityDemand): boolean {
  const original = row.demand_snapshot;
  return original.goalId === demand.goalId && original.projectId === demand.projectId && original.commandId === demand.commandId && original.providerRate === demand.providerRate && original.spendCents === demand.spendCents && original.workerSlots === demand.workerSlots && original.requirement === demand.requirement && original.pressure === demand.pressure && original.priority === demand.priority && canonicalJson(original.admission) === canonicalJson(demand.admission);
}

export async function reserveCapacity(pool: Pool, input: CapacityDemand): Promise<PersistedCapacityAdmission> {
  const demand = capacityDemand(input);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const existing = await client.query<ReservationRow>("SELECT * FROM capacity_reservations WHERE project_id = $1 AND command_id = $2 FOR UPDATE", [demand.projectId, demand.commandId]);
    if (existing.rowCount === 1) {
      const row = existing.rows[0]!;
      if (row.project_id !== demand.projectId || !demandMatches(row, demand)) throw new CapacityReservationError("Capacity command identity was reused with different project, Goal, or demand");
      await client.query("COMMIT"); open = false;
      if (row.status === "queued") return { kind: "queued", reason: row.queue_reason!, demand: map(row), reservationId: row.reservation_id };
      return { kind: "replayed", reservation: map(row) };
    }
    const goal = await client.query<{ project_id: string; state: string }>("SELECT project_id, state FROM goals WHERE goal_id = $1 FOR UPDATE", [demand.goalId]);
    if (goal.rowCount !== 1) throw new CapacityReservationError("Capacity demand Goal does not exist");
    if (goal.rows[0]!.project_id !== demand.projectId) throw new CapacityReservationError("Capacity demand goal is outside the project inventory");
    if (["stopped", "succeeded", "failed"].includes(goal.rows[0]!.state)) throw new CapacityReservationError("Capacity demand Goal is terminal");
    if (demand.actorId !== undefined || demand.fencingToken !== undefined) {
      const lease = await client.query<{ owner_id: string; fencing_token: string; expires_at: Date }>("SELECT owner_id, fencing_token, expires_at FROM goal_leases WHERE goal_id = $1", [demand.goalId]);
      if (lease.rowCount !== 1 || lease.rows[0]!.owner_id !== demand.actorId || String(lease.rows[0]!.fencing_token) !== demand.fencingToken || lease.rows[0]!.expires_at <= new Date()) throw new CapacityReservationError("Capacity demand lease proof is stale");
    }
    const inventory = await client.query<{ provider_rate: number; provider_rate_floor: number; spend_cents: string; spend_cents_floor: string; worker_slots: number; worker_slots_floor: number }>("SELECT provider_rate, provider_rate_floor, spend_cents, spend_cents_floor, worker_slots, worker_slots_floor FROM capacity_inventories WHERE project_id = $1 FOR UPDATE", [demand.projectId]);
    if (inventory.rowCount !== 1) throw new CapacityReservationError(`Capacity inventory is not configured for project ${demand.projectId}`);
    const limits = inventory.rows[0]!;
    const replayAfterLock = await client.query<ReservationRow>("SELECT * FROM capacity_reservations WHERE project_id = $1 AND command_id = $2 FOR UPDATE", [demand.projectId, demand.commandId]);
    if (replayAfterLock.rowCount === 1) {
      const row = replayAfterLock.rows[0]!;
      if (row.project_id !== demand.projectId || !demandMatches(row, demand)) throw new CapacityReservationError("Capacity command identity was reused with different project, Goal, or demand");
      await client.query("COMMIT"); open = false;
      if (row.status === "queued") return { kind: "queued", reason: row.queue_reason!, demand: map(row), reservationId: row.reservation_id };
      return { kind: "replayed", reservation: map(row) };
    }
    const used = await client.query<{ provider_rate: string; spend_cents: string; worker_slots: string }>("SELECT COALESCE(sum(provider_rate) FILTER (WHERE status = 'reserved'), 0)::bigint AS provider_rate, COALESCE(sum(spend_cents) FILTER (WHERE status = 'reserved'), 0)::bigint AS spend_cents, COALESCE(sum(worker_slots) FILTER (WHERE status = 'reserved'), 0)::bigint AS worker_slots FROM capacity_reservations WHERE project_id = $1", [demand.projectId]);
    const active = used.rows[0]!;
    const reason = Number(active.provider_rate) + demand.providerRate > limits.provider_rate - limits.provider_rate_floor ? "provider_rate" : Number(active.spend_cents) + demand.spendCents > Number(limits.spend_cents) - Number(limits.spend_cents_floor) ? "spend_cents" : Number(active.worker_slots) + demand.workerSlots > limits.worker_slots - limits.worker_slots_floor ? "worker_slots" : undefined;
    const reservationId = randomUUID();
    const inserted = await client.query<ReservationRow>(`INSERT INTO capacity_reservations (reservation_id, project_id, goal_id, command_id, provider_rate, spend_cents, worker_slots, requirement, pressure, status, queue_reason, demand_snapshot, actor_id, session_ref, fencing_token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15::bigint) RETURNING *`, [reservationId, demand.projectId, demand.goalId, demand.commandId, demand.providerRate, demand.spendCents, demand.workerSlots, demand.requirement, demand.pressure, reason === undefined ? "reserved" : "queued", reason ?? null, JSON.stringify(demand), demand.actorId ?? null, demand.sessionRef ?? null, demand.fencingToken ?? null]);
    await client.query("COMMIT"); open = false;
    const row = inserted.rows[0]!;
    return reason === undefined ? { kind: "reserved", reservation: map(row) } : { kind: "queued", reason, demand, reservationId };
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function requeueCapacityReservation(pool: Pool, reservationId: string, reason: "provider_rate" | "spend_cents" | "worker_slots" = "worker_slots"): Promise<boolean> {
  const result = await pool.query("UPDATE capacity_reservations SET status = 'queued', queue_reason = $2, released_at = NULL WHERE reservation_id = $1 AND status = 'reserved'", [reservationId, reason]);
  return result.rowCount === 1;
}

export async function releaseCapacityReservation(pool: Pool, reservationId: string): Promise<boolean> {
  const result = await pool.query<{ project_id: string }>("UPDATE capacity_reservations SET status = 'released', released_at = transaction_timestamp(), queue_reason = NULL WHERE reservation_id = $1 AND status IN ('reserved', 'queued') RETURNING project_id", [reservationId]);
  if (result.rowCount !== 1) return false;
  return true;
}
export async function releaseCapacityReservationsForGoal(pool: Pool, goalId: string): Promise<number> {
  const result = await pool.query("UPDATE capacity_reservations SET status = 'released', released_at = transaction_timestamp(), queue_reason = NULL WHERE goal_id = $1 AND status IN ('reserved', 'queued')", [goalId]);
  return result.rowCount ?? 0;
}

export async function claimQueuedCapacity(pool: Pool, projectId: string): Promise<readonly PersistedCapacityReservation[]> {
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const inventory = await client.query<{ provider_rate: number; provider_rate_floor: number; spend_cents: string; spend_cents_floor: string; worker_slots: number; worker_slots_floor: number }>("SELECT provider_rate, provider_rate_floor, spend_cents, spend_cents_floor, worker_slots, worker_slots_floor FROM capacity_inventories WHERE project_id = $1 FOR UPDATE", [projectId]);
    if (inventory.rowCount !== 1) { await client.query("COMMIT"); open = false; return []; }
    const limits = inventory.rows[0]!;
    const used = await client.query<{ provider_rate: string; spend_cents: string; worker_slots: string }>("SELECT COALESCE(sum(provider_rate) FILTER (WHERE status = 'reserved'), 0)::bigint AS provider_rate, COALESCE(sum(spend_cents) FILTER (WHERE status = 'reserved'), 0)::bigint AS spend_cents, COALESCE(sum(worker_slots) FILTER (WHERE status = 'reserved'), 0)::bigint AS worker_slots FROM capacity_reservations WHERE project_id = $1", [projectId]);
    let providerRate = Number(used.rows[0]!.provider_rate), spendCents = Number(used.rows[0]!.spend_cents), workerSlots = Number(used.rows[0]!.worker_slots);
    const queued = await client.query<ReservationRow>("SELECT r.* FROM capacity_reservations r JOIN goals g ON g.goal_id = r.goal_id WHERE r.project_id = $1 AND r.status = 'queued' AND g.state NOT IN ('stopped', 'succeeded', 'failed') ORDER BY r.created_at, r.reservation_id FOR UPDATE OF r", [projectId]);
    const claimed: PersistedCapacityReservation[] = [];
    for (const row of queued.rows) {
      if (providerRate + row.provider_rate > limits.provider_rate - limits.provider_rate_floor || spendCents + Number(row.spend_cents) > Number(limits.spend_cents) - Number(limits.spend_cents_floor) || workerSlots + row.worker_slots > limits.worker_slots - limits.worker_slots_floor) continue;
      const updated = await client.query<ReservationRow>("UPDATE capacity_reservations SET status = 'reserved', queue_reason = NULL WHERE reservation_id = $1 RETURNING *", [row.reservation_id]);
      providerRate += row.provider_rate; spendCents += Number(row.spend_cents); workerSlots += row.worker_slots; claimed.push(map(updated.rows[0]!));
    }
    await client.query("COMMIT"); open = false; return claimed;
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Releases only abandoned reservations with no nonterminal Worker row. Unknown/in-flight provider bindings remain fenced for reconciliation. */
export async function recoverStaleCapacityReservations(pool: Pool, maxAgeMs: number): Promise<number> {
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new CapacityReservationError("maxAgeMs must be a positive safe integer");
  const result = await pool.query<{ project_id: string }>(`UPDATE capacity_reservations r SET status = 'released', released_at = transaction_timestamp(), queue_reason = NULL
    WHERE r.status = 'reserved' AND r.created_at < transaction_timestamp() - ($1::bigint * interval '1 millisecond')
      AND NOT EXISTS (SELECT 1
        FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id JOIN goals wg ON wg.goal_id = hc.goal_id
        WHERE w.spawn_command_id = r.command_id AND wg.project_id = r.project_id
          AND w.status IN ('spawned', 'running', 'awaiting_repair', 'unknown')) RETURNING r.project_id`, [maxAgeMs]);
  return result.rowCount ?? 0;
}

export async function releaseCapacityForWorker(pool: Pool, workerId: string): Promise<number> {
  const result = await pool.query<{ project_id: string }>(`UPDATE capacity_reservations r SET status = 'released', released_at = transaction_timestamp(), queue_reason = NULL
    WHERE r.command_id = (SELECT spawn_command_id FROM workers WHERE worker_id = $1)
      AND r.project_id = (SELECT g.project_id FROM workers w JOIN head_councils hc ON hc.council_id = w.council_id JOIN goals g ON g.goal_id = hc.goal_id WHERE w.worker_id = $1)
      AND r.status IN ('reserved', 'queued') RETURNING r.project_id`, [workerId]);
  return result.rowCount ?? 0;
}

export async function listCapacityInventoryProjects(pool: Pool): Promise<readonly string[]> {
  const result = await pool.query<{ project_id: string }>("SELECT project_id FROM capacity_inventories ORDER BY project_id");
  return result.rows.map((row) => row.project_id);
}
