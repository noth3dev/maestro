import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireGoalLease, executeGoalCommand } from "../../packages/persistence/src/commands.js";
import { runMigrations } from "../../packages/persistence/src/migrate.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

describeDatabase("Plan 8 §S5 Goal command and event latency baseline", () => {
  const schema = `phase8_s5_perf_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const pool = new Pool({ connectionString: (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })() });

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA "${schema}"`);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("records a real PostgreSQL baseline for Goal command and event latency", async () => {
    const commandSamples: number[] = [];
    const eventReadSamples: number[] = [];
    const sampleCount = 20;

    for (let index = 0; index < sampleCount; index += 1) {
      const goalId = randomUUID();
      const projectId = randomUUID();
      const commandId = randomUUID();
      const proof = await acquireGoalLease(pool, { goalId, ownerId: "phase8-s5-benchmark", leaseDurationMs: 60_000 });
      const commandStarted = performance.now();
      const result = await executeGoalCommand(pool, {
        commandId, projectId, goalId, actorId: "phase8-s5-benchmark", type: "CreateGoal", expectedVersion: 0,
      }, proof);
      commandSamples.push(performance.now() - commandStarted);
      expect(result.outcome).toBe("succeeded");

      const eventStarted = performance.now();
      const event = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM goal_events WHERE goal_id = $1 AND project_id = $2",
        [goalId, projectId],
      );
      eventReadSamples.push(performance.now() - eventStarted);
      expect(event.rows[0]?.count).toBe(1);
    }

    const baseline = {
      metric: "goal-command-and-event-latency",
      database: "postgresql",
      sampleCount,
      commandMs: { p50: percentile(commandSamples, 0.5), p95: percentile(commandSamples, 0.95), max: Math.max(...commandSamples) },
      eventReadMs: { p50: percentile(eventReadSamples, 0.5), p95: percentile(eventReadSamples, 0.95), max: Math.max(...eventReadSamples) },
    };
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
    expect(commandSamples).toHaveLength(sampleCount);
    expect(eventReadSamples).toHaveLength(sampleCount);
  });
});
