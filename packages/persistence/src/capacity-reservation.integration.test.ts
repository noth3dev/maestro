import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { claimQueuedCapacity, recoverStaleCapacityReservations, releaseCapacityReservation, reserveCapacity, upsertCapacityInventory } from "./capacity-reservation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("capacity reservations with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => { await applyAllMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("serializes reservation, queues contention, claims FIFO after release, and replays commands", async () => {
    const projectId = randomUUID();
    const goalA = randomUUID();
    const goalB = randomUUID();
    const commandA = randomUUID();
    const commandB = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp()), ($3, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalA, projectId, goalB]);
    await upsertCapacityInventory(pool, { projectId, providerRate: 10, spendCents: 100, workerSlots: 1 });
    const first = await reserveCapacity(pool, { goalId: goalA, projectId, commandId: commandA, providerRate: 1, spendCents: 10, workerSlots: 1, requirement: "high", pressure: "normal" });
    const queued = await reserveCapacity(pool, { goalId: goalB, projectId, commandId: commandB, providerRate: 1, spendCents: 10, workerSlots: 1, requirement: "high", pressure: "elevated" });
    expect(first.kind).toBe("reserved");
    expect(queued).toMatchObject({ kind: "queued", reason: "worker_slots" });
    if (first.kind !== "reserved") return;
    expect((await reserveCapacity(pool, { goalId: goalA, projectId, commandId: commandA, providerRate: 1, spendCents: 10, workerSlots: 1, requirement: "high", pressure: "normal" })).kind).toBe("replayed");
    expect(await releaseCapacityReservation(pool, first.reservation.reservationId)).toBe(true);
    expect(await releaseCapacityReservation(pool, first.reservation.reservationId)).toBe(false);
    expect((await claimQueuedCapacity(pool, projectId)).length).toBe(1);
    await expect(pool.query("UPDATE capacity_reservations SET provider_rate = provider_rate + 1 WHERE reservation_id = $1", [first.reservation.reservationId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM capacity_reservations WHERE reservation_id = $1", [first.reservation.reservationId])).rejects.toThrow();
    const terminalQueued = await reserveCapacity(pool, { goalId: goalA, projectId, commandId: randomUUID(), providerRate: 1, spendCents: 10, workerSlots: 1, requirement: "high", pressure: "normal" });
    expect(terminalQueued.kind).toBe("queued");
    if (terminalQueued.kind === "queued") {
      await expect(pool.query("UPDATE capacity_reservations SET status = 'released', released_at = transaction_timestamp(), queue_reason = NULL WHERE reservation_id = $1", [terminalQueued.reservationId])).resolves.toMatchObject({ rowCount: 1 });
    }
  });

  it("rejects command replay with changed demand or project and preserves released status", async () => {
    const projectId = randomUUID(), otherProjectId = randomUUID(), goalId = randomUUID(), otherGoalId = randomUUID(), commandId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $3, 'active', 1, transaction_timestamp(), transaction_timestamp()), ($2, $4, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, otherGoalId, projectId, otherProjectId]);
    await upsertCapacityInventory(pool, { projectId, providerRate: 2, spendCents: 10, workerSlots: 1 });
    await upsertCapacityInventory(pool, { projectId: otherProjectId, providerRate: 2, spendCents: 10, workerSlots: 1 });
    const demand = { goalId, projectId, commandId, providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high" as const, pressure: "normal" as const };
    const first = await reserveCapacity(pool, demand); expect(first.kind).toBe("reserved");
    await expect(reserveCapacity(pool, { ...demand, pressure: "critical" })).rejects.toThrow("reused");
    expect((await reserveCapacity(pool, { ...demand, goalId: otherGoalId, projectId: otherProjectId })).kind).toBe("reserved");
    if (first.kind === "reserved") { await releaseCapacityReservation(pool, first.reservation.reservationId); const replay = await reserveCapacity(pool, demand); expect(replay).toMatchObject({ kind: "replayed", reservation: { status: "released" } }); }
  });

  it("replays equivalent admission metadata regardless of object key order", async () => {
    const projectId = randomUUID(), goalId = randomUUID(), commandId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await upsertCapacityInventory(pool, { projectId, providerRate: 2, spendCents: 10, workerSlots: 1 });
    const first = await reserveCapacity(pool, { goalId, projectId, commandId, providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high", pressure: "normal", admission: { councilId: "council", departmentId: "coding", planVersion: 1, itemId: "item", operatorId: "operator", credentialId: "credential", repositoryPath: "/workspace/project", worktreePath: "/workspace/worker" } });
    expect(first.kind).toBe("reserved");
    const replay = await reserveCapacity(pool, { goalId, projectId, commandId, providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high", pressure: "normal", admission: { worktreePath: "/workspace/worker", repositoryPath: "/workspace/project", credentialId: "credential", operatorId: "operator", itemId: "item", planVersion: 1, departmentId: "coding", councilId: "council" } });
    expect(replay.kind).toBe("replayed");
  });

  it("serializes concurrent contenders so only one consumes a single slot", async () => {
    const projectId = randomUUID(), goalA = randomUUID(), goalB = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $3, 'active', 1, transaction_timestamp(), transaction_timestamp()), ($2, $3, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalA, goalB, projectId]);
    await upsertCapacityInventory(pool, { projectId, providerRate: 10, spendCents: 100, workerSlots: 1 });
    const demandFor = (goalId: string) => ({ goalId, projectId, commandId: randomUUID(), providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high" as const, pressure: "normal" as const });
    const results = await Promise.all([reserveCapacity(pool, demandFor(goalA)), reserveCapacity(pool, demandFor(goalB))]);
    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "queued")).toHaveLength(1);
  });

  it("advances three Goals across two projects without crossing inventory boundaries", async () => {
    const projectA = randomUUID(), projectB = randomUUID(), goalA1 = randomUUID(), goalA2 = randomUUID(), goalB = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $4, 'active', 1, transaction_timestamp(), transaction_timestamp()), ($2, $4, 'active', 1, transaction_timestamp(), transaction_timestamp()), ($3, $5, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalA1, goalA2, goalB, projectA, projectB]);
    await upsertCapacityInventory(pool, { projectId: projectA, providerRate: 10, spendCents: 10, workerSlots: 1 });
    await upsertCapacityInventory(pool, { projectId: projectB, providerRate: 10, spendCents: 10, workerSlots: 1 });
    const make = (goalId: string, projectId: string) => ({ goalId, projectId, commandId: randomUUID(), providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high" as const, pressure: "normal" as const });
    const first = await reserveCapacity(pool, make(goalA1, projectA));
    const queued = await reserveCapacity(pool, make(goalA2, projectA));
    const other = await reserveCapacity(pool, make(goalB, projectB));
    expect(first.kind).toBe("reserved"); expect(queued.kind).toBe("queued"); expect(other.kind).toBe("reserved");
    if (first.kind === "reserved") { await releaseCapacityReservation(pool, first.reservation.reservationId); await claimQueuedCapacity(pool, projectA); }
    const states = await pool.query<{ status: string }>("SELECT status FROM capacity_reservations WHERE goal_id IN ($1, $2, $3) ORDER BY goal_id", [goalA1, goalA2, goalB]);
    expect(states.rows.map((row) => row.status).sort()).toEqual(["released", "reserved", "reserved"]);
  });

  it("recovers an abandoned reservation but keeps an unknown worker reservation fenced", async () => {
    const projectId = randomUUID(), goalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await upsertCapacityInventory(pool, { projectId, providerRate: 2, spendCents: 10, workerSlots: 1 });
    const reservationId = randomUUID();
    const commandId = randomUUID();
    await pool.query(`INSERT INTO capacity_reservations (reservation_id, project_id, goal_id, command_id, provider_rate, spend_cents, worker_slots, requirement, pressure, status, demand_snapshot, created_at) VALUES ($1, $2, $3, $4, 1, 1, 1, 'high', 'normal', 'reserved', jsonb_build_object('projectId', $5::text, 'goalId', $6::text, 'commandId', $7::text, 'providerRate', 1, 'spendCents', 1, 'workerSlots', 1, 'requirement', 'high', 'pressure', 'normal'), transaction_timestamp() - interval '1 hour')`, [reservationId, projectId, goalId, commandId, projectId, goalId, commandId]);
    expect(await recoverStaleCapacityReservations(pool, 1)).toBeGreaterThanOrEqual(1);
  });

  it("rejects a Goal whose durable project differs from the inventory", async () => {
    const projectId = randomUUID(), otherProjectId = randomUUID(), goalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, otherProjectId]);
    await upsertCapacityInventory(pool, { projectId, providerRate: 2, spendCents: 10, workerSlots: 1 });
    await expect(reserveCapacity(pool, { goalId, projectId, commandId: randomUUID(), providerRate: 1, spendCents: 1, workerSlots: 1, requirement: "high", pressure: "normal" })).rejects.toThrow("outside the project");
  });

  it("keeps protected floor unavailable for reservations", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await upsertCapacityInventory(pool, { projectId, providerRate: 2, spendCents: 100, workerSlots: 2, workerSlotsFloor: 1 });
    const result = await reserveCapacity(pool, { goalId, projectId, commandId: randomUUID(), providerRate: 1, spendCents: 1, workerSlots: 2, requirement: "high", pressure: "critical" });
    expect(result.kind).toBe("queued");
  });
});
