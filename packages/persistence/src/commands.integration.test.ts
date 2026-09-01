import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CommandIdReuseError,
  LeaseUnavailableError,
  acquireGoalLease,
  executeGoalCommand,
  renewGoalLease,
} from "./commands.js";
import { listGoalEvents } from "./events.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Goal lease fencing with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function lease(goalId: string, ownerId: string, leaseDurationMs = 60_000) {
    return acquireGoalLease(pool, { goalId, ownerId, leaseDurationMs });
  }

  async function counts() {
    const result = await pool.query(`SELECT
      (SELECT count(*)::int FROM command_receipts) receipts,
      (SELECT count(*)::int FROM goal_events) events,
      (SELECT count(*)::int FROM goals) goals,
      (SELECT count(*)::int FROM outbox) outbox`);
    return result.rows[0];
  }

  beforeAll(async () => {
    // `retention_class` is shared, idempotently created infrastructure (see
    // 0001's DO block) now also used by other integration suites' tables
    // (e.g. evidence_records). Dropping it here would cascade into their
    // columns when suites share one database. Only this suite's own tables
    // are reset.
    await pool.query("DROP TABLE IF EXISTS goal_leases, outbox, goal_events, goals, command_receipts CASCADE");
    for (const name of ["0001_phase1_core.sql", "0002_goal_leases.sql"]) {
      const migration = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(migration);
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE goal_leases, outbox, goal_events, goals, command_receipts RESTART IDENTITY CASCADE");
  });

  afterAll(async () => { await pool.end(); });

  it("replays project-scoped events strictly after an exact global cursor", async () => {
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const firstGoal = randomUUID();
    const secondGoal = randomUUID();
    for (const [goalId, id, project] of [[firstGoal, randomUUID(), projectId], [secondGoal, randomUUID(), projectId], [randomUUID(), randomUUID(), otherProjectId]] as const) {
      const proof = await lease(goalId, "reader");
      await executeGoalCommand(pool, { commandId: id, projectId: project, goalId, actorId: "reader", type: "CreateGoal", expectedVersion: 0 }, proof);
    }
    await pool.query("SELECT setval(pg_get_serial_sequence('goal_events', 'global_position'), 9007199254740992, true)");
    const proof = await lease(randomUUID(), "reader");
    const largeGoal = proof.goalId;
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId: largeGoal, actorId: "reader", type: "CreateGoal", expectedVersion: 0 }, proof);
    const all = await listGoalEvents(pool, { projectId, after: "0" });
    expect(all).toHaveLength(3);
    expect(all.map((event) => event.cursor)).toEqual([...all.map((event) => event.cursor)].sort((a, b) => a.length - b.length || a.localeCompare(b)));
    expect(all.at(-1)?.cursor).toBe("9007199254740993");
    expect((await listGoalEvents(pool, { projectId, after: all[0]!.cursor })).map((event) => event.cursor)).toEqual(all.slice(1).map((event) => event.cursor));
    expect(all.every((event) => event.projectId === projectId)).toBe(true);
  });

  it("acquires an exact bigint fencing token", async () => {
    const goalId = randomUUID();
    await expect(lease(goalId, "sane")).resolves.toEqual({ goalId, ownerId: "sane", fencingToken: "1" });
  });

  it("allows only one concurrent acquisition before expiry", async () => {
    const goalId = randomUUID();
    const attempts = await Promise.allSettled([lease(goalId, "sane"), lease(goalId, "other")]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(LeaseUnavailableError) });
  });

  it("gives an expired lease successor a higher exact bigint token", async () => {
    const goalId = randomUUID();
    const first = await lease(goalId, "sane");
    await pool.query("UPDATE goal_leases SET fencing_token = 9007199254740992, expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    await expect(lease(goalId, "other")).resolves.toEqual({
      goalId, ownerId: "other", fencingToken: "9007199254740993",
    });
    expect(first.fencingToken).toBe("1");
  });

  it("renews only a current matching proof and retains its token", async () => {
    const proof = await lease(randomUUID(), "sane", 1_000);
    await expect(renewGoalLease(pool, proof, 60_000)).resolves.toEqual(proof);
  });

  it("rejects expired or forged renewal proofs", async () => {
    const proof = await lease(randomUUID(), "sane");
    await expect(renewGoalLease(pool, { ...proof, fencingToken: "999" }, 60_000))
      .rejects.toMatchObject({ code: "stale_lease" });
    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [proof.goalId]);
    await expect(renewGoalLease(pool, proof, 60_000)).rejects.toMatchObject({ code: "stale_lease" });
  });

  it("validates the lease proof before receipt lookup and preserves idempotency for a current proof", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "sane", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, command.actorId);
    const first = await executeGoalCommand(pool, command, proof);
    await expect(executeGoalCommand(pool, command, proof)).resolves.toEqual(first);
    await expect(executeGoalCommand(pool, { ...command, projectId: randomUUID() }, proof)).rejects.toBeInstanceOf(CommandIdReuseError);

    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [command.goalId]);
    await expect(executeGoalCommand(pool, command, proof)).rejects.toMatchObject({ code: "stale_lease" });
  });

  it("atomically creates receipt, event, projection, and outbox with a current proof", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "sane", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, command.actorId);

    await expect(executeGoalCommand(pool, command, proof)).resolves.toMatchObject({
      outcome: "succeeded", goalId: command.goalId, version: 1, state: "draft",
    });
    expect(await counts()).toEqual({ receipts: 1, events: 1, goals: 1, outbox: 1 });
  });

  it("allows an operator-audited command under a current control-plane lease", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "operator-B", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, "instance-A");

    await expect(executeGoalCommand(pool, command, proof)).resolves.toMatchObject({
      outcome: "succeeded", goalId: command.goalId, state: "draft",
    });
    expect(await counts()).toEqual({ receipts: 1, events: 1, goals: 1, outbox: 1 });
  });

  it("rejects a wrong Goal, token, or expired proof before command mutation", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "operator-B", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, "instance-A");
    const before = await counts();

    await expect(executeGoalCommand(pool, command, { ...proof, goalId: randomUUID() }))
      .rejects.toMatchObject({ code: "stale_lease" });
    await expect(executeGoalCommand(pool, command, { ...proof, fencingToken: "999" }))
      .rejects.toMatchObject({ code: "stale_lease" });
    await pool.query(
      "UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1",
      [proof.goalId],
    );
    await expect(executeGoalCommand(pool, command, proof)).rejects.toMatchObject({ code: "stale_lease" });
    expect(await counts()).toEqual(before);
  });

  it("allows only one command at an expected Goal version", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await lease(goalId, "sane");
    await executeGoalCommand(pool, {
      commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0,
    }, proof);
    const base = { projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 1 } as const;
    const [a, b] = await Promise.all([
      executeGoalCommand(pool, { ...base, commandId: randomUUID(), to: "ready_for_confirmation" }, proof),
      executeGoalCommand(pool, { ...base, commandId: randomUUID(), to: "recovering" }, proof),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["succeeded", "version_conflict"]);
    expect(await counts()).toEqual({ receipts: 3, events: 2, goals: 1, outbox: 2 });
  });

  it("denies an old token from the same owner without changing persistent command state", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "sane", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const oldProof = await lease(command.goalId, command.actorId);
    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [command.goalId]);
    const currentProof = await lease(command.goalId, command.actorId);
    expect(currentProof.fencingToken).toBe("2");

    const before = await counts();
    await expect(executeGoalCommand(pool, command, oldProof)).rejects.toMatchObject({ code: "stale_lease" });
    expect(await counts()).toEqual(before);
    await expect(executeGoalCommand(pool, command, currentProof)).resolves.toMatchObject({ outcome: "succeeded" });
  });

  it("rejects a forged proof without changing receipt, event, projection, or outbox", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "sane", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const proof = await lease(command.goalId, command.actorId);
    const before = await counts();
    await expect(executeGoalCommand(pool, command, { ...proof, fencingToken: "999" }))
      .rejects.toMatchObject({ code: "stale_lease" });
    expect(await counts()).toEqual(before);
  });
});
