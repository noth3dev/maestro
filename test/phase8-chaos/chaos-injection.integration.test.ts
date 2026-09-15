import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deriveDiscordIncidentFingerprint, signDiscordSignal, type DiscordSignal } from "@maestro/domain";
import { applyAllMigrations, acquireGoalLease, executeGoalCommand, reconcileOnStartup, listDiscordSignals, recordDiscordSignal } from "@maestro/persistence";
import { createChaosInjector } from "./chaos-injection.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Phase 8 §S3 real PostgreSQL chaos boundaries", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `phase8_s3_chaos_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  const pool = new Pool({ connectionString: scopedUrl });

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE reconciler_leader_lease, goal_controls, goal_leases, outbox, goal_events, goals, command_receipts, discord_signals, discord_incident_signals, discord_incidents RESTART IDENTITY CASCADE");
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  async function createGoal(projectId = randomUUID()) {
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: `chaos-${randomUUID()}`, leaseDurationMs: 60_000 });
    const command = { commandId: randomUUID(), projectId, goalId, actorId: "chaos-test", type: "CreateGoal" as const, expectedVersion: 0 as const };
    return { goalId, projectId, proof, command };
  }

  it("rolls back every durable write when termination lands before commit, then retries exactly once", async () => {
    const setup = await createGoal();
    const chaos = createChaosInjector().inject("goal.before-commit", { kind: "throw", error: new Error("control-plane terminated") });
    await expect(executeGoalCommand(pool, setup.command, setup.proof, { beforeCommit: () => chaos.checkpoint("goal.before-commit") })).rejects.toThrow("control-plane terminated");
    expect((await pool.query("SELECT count(*)::int AS count FROM goals WHERE goal_id = $1", [setup.goalId])).rows[0]!.count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM command_receipts WHERE command_id = $1", [setup.command.commandId])).rows[0]!.count).toBe(0);

    const committed = await executeGoalCommand(pool, setup.command, setup.proof);
    expect(committed).toMatchObject({ outcome: "succeeded", goalId: setup.goalId, version: 1, state: "draft" });
    expect((await pool.query("SELECT count(*)::int AS count FROM goal_events WHERE goal_id = $1", [setup.goalId])).rows[0]!.count).toBe(1);
  });

  it("reconnects to PostgreSQL and replays a committed command without duplicate application", async () => {
    const setup = await createGoal();
    const first = await executeGoalCommand(pool, setup.command, setup.proof);
    const disconnected = new Pool({ connectionString: scopedUrl });
    await disconnected.query("SELECT 1");
    await disconnected.end();
    const reconnected = new Pool({ connectionString: scopedUrl });
    try {
      const replay = await executeGoalCommand(reconnected, setup.command, setup.proof);
      expect(replay).toEqual(first);
      expect((await reconnected.query("SELECT count(*)::int AS count FROM goal_events WHERE goal_id = $1", [setup.goalId])).rows[0]!.count).toBe(1);
      expect((await reconnected.query("SELECT count(*)::int AS count FROM outbox WHERE event_id = $1", [first.eventId])).rows[0]!.count).toBe(1);
    } finally {
      await reconnected.end();
    }
  });

  it("marks a stale post-termination Goal recovering instead of resuming it", async () => {
    const setup = await createGoal();
    await executeGoalCommand(pool, setup.command, setup.proof);
    let version = 1;
    for (const to of ["ready_for_confirmation", "launched", "active"] as const) {
      const result = await executeGoalCommand(pool, { commandId: randomUUID(), projectId: setup.projectId, goalId: setup.goalId, actorId: "chaos-test", type: "TransitionGoal", expectedVersion: version, to }, setup.proof);
      expect(result.outcome).toBe("succeeded");
      version += 1;
    }
    await pool.query("UPDATE goal_controls SET emergency_stopped_at = transaction_timestamp() WHERE goal_id = $1", [setup.goalId]);
    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [setup.goalId]);
    const report = await reconcileOnStartup(pool, { ownerId: `chaos-reconciler-${randomUUID()}` });
    expect(report.results).toEqual([expect.objectContaining({ goalId: setup.goalId, outcome: "recovering", reasons: ["emergency_stop_state_mismatch"] })]);
    expect((await pool.query("SELECT state FROM goals WHERE goal_id = $1", [setup.goalId])).rows[0]!.state).toBe("recovering");
  });

  it("rejects a stale command after app reconnect without replaying the transition", async () => {
    const setup = await createGoal();
    const created = await executeGoalCommand(pool, setup.command, setup.proof);
    const transition = { commandId: randomUUID(), projectId: setup.projectId, goalId: setup.goalId, actorId: "chaos-test", type: "TransitionGoal" as const, expectedVersion: 1, to: "ready_for_confirmation" as const };
    await expect(executeGoalCommand(pool, transition, setup.proof)).resolves.toMatchObject({ outcome: "succeeded", version: 2 });
    const stale = await executeGoalCommand(pool, { ...transition, commandId: randomUUID() }, setup.proof);
    expect(stale).toMatchObject({ outcome: "version_conflict", expectedVersion: 1, actualVersion: 2 });
    expect((await pool.query("SELECT count(*)::int AS count FROM goal_events WHERE goal_id = $1", [created.goalId])).rows[0]!.count).toBe(2);
  });

  it("keeps Discord outage retries and duplicate delivery distinct and idempotent", async () => {
    const signal: DiscordSignal = {
      incidentFingerprint: "", firstObservedAt: "2026-01-01T00:00:00.000Z", lastObservedAt: "2026-01-01T00:00:01.000Z",
      severity: "warning", confidence: 0.9, affectedComponent: "control-plane", affectedVersion: "1.0.0",
      minimalReproductionEvidence: ["GET /health -> 503"], source: "chaos-test", sourceFreshness: "2026-01-01T00:00:01.000Z",
      deduplicationRelationship: "new", discordHealthState: "healthy",
    };
    const signed = signDiscordSignal({ ...signal, incidentFingerprint: deriveDiscordIncidentFingerprint(signal) }, "s3-secret", "s3-nonce", 1, "2026-01-01T00:00:05.000Z");
    await expect(recordDiscordSignal(pool, signed, "wrong-secret", { now: new Date("2026-01-01T00:00:10.000Z") })).rejects.toThrow();
    const accepted = await recordDiscordSignal(pool, signed, "s3-secret", { now: new Date("2026-01-01T00:00:10.000Z") });
    await expect(recordDiscordSignal(pool, signed, "s3-secret", { now: new Date("2026-01-01T00:00:10.000Z") })).rejects.toThrow();
    expect(accepted.sequence).toBe(1);
    expect(await listDiscordSignals(pool)).toHaveLength(1);
  });

});
