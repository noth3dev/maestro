import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@maestro/persistence";
import { measurePostgresQueryStorageGrowth } from "./postgres-query-storage-growth-baseline.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Plan 8 §S5 PostgreSQL query and storage growth baseline", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `postgres_perf_${randomUUID().replaceAll("-", "")}`;
  const projectId = randomUUID();
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("records durable event replay query cost and relation growth without thresholds", async () => {
    const baseline = await measurePostgresQueryStorageGrowth(pool, projectId);
    expect(baseline.sampleCount).toBe(10);
    expect(baseline.goals).toBe(10);
    expect(baseline.eventsGenerated).toBeGreaterThan(400);
    expect(baseline.replayQueryMs.p50).toBeGreaterThanOrEqual(0);
    expect(baseline.replayQueryMs.p95).toBeGreaterThanOrEqual(baseline.replayQueryMs.p50);
    expect(baseline.replayQueryMs.max).toBeGreaterThanOrEqual(baseline.replayQueryMs.p95);
    expect(baseline.replayPages.max).toBeGreaterThan(1);
    expect(baseline.invariants.projectScopePreserved).toBe(true);
    expect(baseline.invariants.cursorsStrictlyIncreasing).toBe(true);
    expect(baseline.invariants.finalGoalVersionsCorrect).toBe(true);
    expect(baseline.storage.tables.goal_events.rows).toBe(baseline.eventsGenerated);
    expect(baseline.storage.tables.command_receipts.rows).toBe(baseline.commandsGenerated);
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
  });
});
