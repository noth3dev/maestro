import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { METRONOME_ACTOR_ID, type GoalState } from "../../packages/domain/src/index.js";
import { createMetronomeLoop } from "../../apps/control-plane/src/metronome-loop.js";
import { runMigrations } from "../../packages/persistence/src/index.js";
import { bootstrapPermanentOrganization } from "../../packages/persistence/src/index.js";
import { acquireGoalLease, executeGoalCommand, releaseGoalLease, reconcileOnStartup } from "../../packages/persistence/src/index.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const NONTERMINAL_GOAL_COUNT = 20;
const SAMPLE_COUNT = 10;

function percentile(samples: readonly number[], quantile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

async function createActiveGoal(pool: Pool): Promise<string> {
  const goalId = randomUUID();
  const projectId = randomUUID();
  const proof = await acquireGoalLease(pool, { goalId, ownerId: `phase8-s5-setup-${goalId}`, leaseDurationMs: 120_000 });
  try {
    await executeGoalCommand(pool, {
      commandId: randomUUID(), projectId, goalId, actorId: "phase8-s5-setup", type: "CreateGoal", expectedVersion: 0,
    }, proof);
    let expectedVersion = 1;
    for (const to of ["ready_for_confirmation", "launched", "active"] as const) {
      const result = await executeGoalCommand(pool, {
        commandId: randomUUID(), projectId, goalId, actorId: "phase8-s5-setup", type: "TransitionGoal", expectedVersion, to,
      }, proof);
      expect(result.outcome).toBe("succeeded");
      expectedVersion = result.version!;
    }
    await pool.query(
      `INSERT INTO goal_controls (project_id, goal_id)
       VALUES ($1, $2)
       ON CONFLICT (project_id, goal_id) DO NOTHING`,
      [projectId, goalId],
    );
  } finally {
    await releaseGoalLease(pool, proof);
  }
  return goalId;
}

describeDatabase("Plan 8 §S5 scheduler and reconciliation startup latency baseline", () => {
  const schema = `phase8_s5_scheduler_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  const pool = new Pool({ connectionString: scopedUrl });

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA "${schema}"`);
    await runMigrations(pool);
    await bootstrapPermanentOrganization(pool);
    for (let index = 0; index < NONTERMINAL_GOAL_COUNT; index += 1) await createActiveGoal(pool);
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("records scheduler-pass and startup-reconciliation latency over representative nonterminal Goal count", async () => {
    const withGoalLease = async <T>(goalId: string, operation: (proof: import("../../packages/persistence/src/commands.js").GoalLeaseProof) => Promise<T>): Promise<T> => {
      const proof = await acquireGoalLease(pool, { goalId, ownerId: `phase8-s5-scheduler-${randomUUID()}`, leaseDurationMs: 120_000 });
      try {
        return await operation(proof);
      } finally {
        await releaseGoalLease(pool, proof);
      }
    };
    const scanOutcomes: Array<{ goalId: string; outcome: string }> = [];
    const scheduler = createMetronomeLoop({
      pool,
      withGoalLease,
      intervalMs: 60_000,
      onTick: ({ goalId, outcome }) => scanOutcomes.push({ goalId, outcome }),
    });
    const schedulerSamples: number[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      scanOutcomes.length = 0;
      const started = performance.now();
      await scheduler.runOnce();
      schedulerSamples.push(performance.now() - started);
      expect(scanOutcomes).toHaveLength(NONTERMINAL_GOAL_COUNT);
      expect(scanOutcomes.every((result) => result.outcome === "scanned")).toBe(true);
    }

    const reconciliationSamples: number[] = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      if (index > 0) {
        await pool.query("UPDATE reconciler_leader_lease SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE lease_key = 'singleton'");
      }
      const started = performance.now();
      const report = await reconcileOnStartup(pool, { ownerId: `phase8-s5-reconciler-${index}-${randomUUID()}`, leaderLeaseDurationMs: 120_000 });
      reconciliationSamples.push(performance.now() - started);
      expect(report.checkedGoalCount).toBe(NONTERMINAL_GOAL_COUNT);
      expect(report.results.every((result) => result.priorState === ("active" satisfies GoalState) && result.outcome === "consistent")).toBe(true);
    }

    const baseline = {
      metric: "scheduler-and-reconciliation-startup-latency",
      database: "postgresql",
      nonterminalGoalCount: NONTERMINAL_GOAL_COUNT,
      sampleCount: SAMPLE_COUNT,
      schedulerPassMs: { p50: percentile(schedulerSamples, 0.5), p95: percentile(schedulerSamples, 0.95), max: Math.max(...schedulerSamples) },
      reconciliationMs: { p50: percentile(reconciliationSamples, 0.5), p95: percentile(reconciliationSamples, 0.95), max: Math.max(...reconciliationSamples) },
      metronomeActor: METRONOME_ACTOR_ID,
    };
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
    expect(schedulerSamples).toHaveLength(SAMPLE_COUNT);
    expect(reconciliationSamples).toHaveLength(SAMPLE_COUNT);
  });
});
