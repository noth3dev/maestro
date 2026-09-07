import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations, bootstrapPermanentOrganization } from "@maestro/persistence";
import { createDurableGoalService } from "./goal-service.js";
import { createMetronomeLoop } from "./metronome-loop.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("real Metronome continuous-observation loop with a real GoalService, real leases, and real PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `metronome_loop_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE metronome_findings, goal_leases, outbox, goal_events, command_receipts, goals CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  async function insertGoal(state: string): Promise<string> {
    const goalId = randomUUID();
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, $3, 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, randomUUID(), state],
    );
    return goalId;
  }

  it("scans every non-terminal Goal through a real Goal lease on one real pass, skips terminal Goals entirely, and durably finds nothing wrong with a routine Goal", async () => {
    const activeGoalId = await insertGoal("active");
    const pausedGoalId = await insertGoal("paused");
    const stoppedGoalId = await insertGoal("stopped");

    // No injected withGoalLease/scanGoal seam: this is the exact real
    // GoalService.withGoalLease production composition uses
    // (apps/control-plane/src/main.ts), acquiring a genuine PostgreSQL Goal
    // lease per Goal, and the loop's default real scanGoalForMetronomeFindings.
    const goalService = createDurableGoalService({ pool, leaseOwnerId: `metronome-loop-test-${randomUUID()}` });
    const ticks: { goalId: string; outcome: string }[] = [];
    const loop = createMetronomeLoop({
      pool, withGoalLease: goalService.withGoalLease!, intervalMs: 60_000,
      onTick: (result) => ticks.push({ goalId: result.goalId, outcome: result.outcome }),
    });

    await loop.runOnce();

    const scannedGoalIds = ticks.map((tick) => tick.goalId).sort();
    expect(scannedGoalIds).toEqual([activeGoalId, pausedGoalId].sort());
    expect(ticks.every((tick) => tick.outcome === "scanned")).toBe(true);
    expect(scannedGoalIds).not.toContain(stoppedGoalId);

    // Each real scan durably acquired and released its own Goal lease; a
    // second real pass immediately afterward must not be blocked by a lease
    // the first pass failed to release.
    ticks.length = 0;
    await loop.runOnce();
    expect(ticks.map((tick) => tick.goalId).sort()).toEqual([activeGoalId, pausedGoalId].sort());

    const findings = await pool.query("SELECT goal_id FROM metronome_findings");
    expect(findings.rows).toEqual([]);
  });
});
