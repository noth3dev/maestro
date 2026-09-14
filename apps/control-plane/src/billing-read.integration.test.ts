import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { bootstrapPermanentOrganization } from "@maestro/persistence";
import { applyAllMigrations } from "../../../packages/persistence/src/test-migrations.js";
import { createReadStateService } from "./read-state-service.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("durable billing read model", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  beforeAll(async () => {
    await applyAllMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });
  afterEach(async () => {
    // Reservations and actual-cost records are immutable (DELETE is rejected by
    // their database triggers), so the disposable test database is reset with
    // TRUNCATE rather than attempting row cleanup.
    await pool.query("TRUNCATE goal_actual_costs, budget_reservations, goals RESTART IDENTITY CASCADE");
  });
  afterAll(async () => { await pool.end(); });

  it("uses durable incurred costs for 14-day history and reconciles totals across Goals", async () => {
    const projectId = randomUUID();
    const goalIds = [randomUUID(), randomUUID()];
    const today = new Date();
    const utcDate = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)).toISOString().slice(0, 10);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, now(), now()), ($3, $2, 'active', 1, now(), now())", [goalIds[0], projectId, goalIds[1]]);

    for (const [goalId, budget, reserved] of [[goalIds[0]!, 1000, 200], [goalIds[1]!, 2000, 300]] as const) {
      const envelopeId = randomUUID();
      await pool.query("INSERT INTO budget_reservations (reservation_id, scope, goal_id, amount_cents, reason, actor_id, session_ref) VALUES ($1, 'goal', $2, $3, 'envelope', 'test', 'billing-test')", [envelopeId, goalId, budget]);
      await pool.query("INSERT INTO budget_reservations (reservation_id, scope, goal_id, department_id, council_id, parent_reservation_id, amount_cents, reason, actor_id, session_ref) VALUES ($1, 'department', $2, 'product', $3, $4, $5, 'allocation', 'test', 'billing-test')", [randomUUID(), goalId, randomUUID(), envelopeId, reserved]);
    }
    await pool.query("INSERT INTO goal_actual_costs (cost_id, goal_id, command_id, amount_cents, source, actor_id, session_ref, recorded_at) VALUES ($1, $2, $3, 125, 'worker', 'test', 'billing-test', $4), ($5, $6, $7, 75, 'worker', 'test', 'billing-test', $4), ($8, $2, $9, 25, 'worker', 'test', 'billing-test', $10), ($11, $6, $12, 999, 'worker', 'test', 'billing-test', $13)", [
      randomUUID(), goalIds[0], randomUUID(), `${utcDate(0)}T10:00:00Z`,
      randomUUID(), goalIds[1], randomUUID(), randomUUID(), randomUUID(), `${utcDate(-1)}T10:00:00Z`,
      randomUUID(), randomUUID(), `${utcDate(-20)}T10:00:00Z`,
    ]);

    const billing = await createReadStateService(pool).getBillingSummary(projectId);
    expect(billing.periodDays).toBe(14);
    expect(billing.dailySpend).toHaveLength(14);
    expect(billing.dailySpend.find((day) => day.date === utcDate(0))?.costCents).toBe(200);
    expect(billing.dailySpend.find((day) => day.date === utcDate(-1))?.costCents).toBe(25);
    expect(billing.goals).toEqual([
      { goalId: goalIds[0], budgetCents: 1000, reservedCents: 200, costCents: 150 },
      { goalId: goalIds[1], budgetCents: 2000, reservedCents: 300, costCents: 75 },
    ]);
    expect(billing.totals).toEqual({ budgetCents: 3000, reservedCents: 500, costCents: 225 });
    expect(billing.departmentBreakdown).toEqual({ available: false, reason: "Actual costs are tracked at Goal scope only" });
  });
});
