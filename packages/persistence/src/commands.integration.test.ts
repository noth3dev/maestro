import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CommandIdReuseError, executeGoalCommand } from "./commands.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("executeGoalCommand with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS outbox, goal_events, goals, command_receipts CASCADE");
    await pool.query("DROP TYPE IF EXISTS retention_class CASCADE");
    const migration = await readFile(
      fileURLToPath(new URL("../migrations/0001_phase1_core.sql", import.meta.url)),
      "utf8",
    );
    await pool.query(migration);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox, goal_events, goals, command_receipts RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("atomically creates receipt, event, projection, and outbox", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "sane", type: "CreateGoal", expectedVersion: 0,
    } as const;

    await expect(executeGoalCommand(pool, command)).resolves.toMatchObject({
      outcome: "succeeded", goalId: command.goalId, version: 1, state: "draft",
    });
    const counts = await pool.query(`SELECT
      (SELECT count(*)::int FROM command_receipts) receipts,
      (SELECT count(*)::int FROM goal_events) events,
      (SELECT count(*)::int FROM goals) goals,
      (SELECT count(*)::int FROM outbox) outbox`);
    expect(counts.rows[0]).toEqual({ receipts: 1, events: 1, goals: 1, outbox: 1 });
  });

  it("returns the stored result for an identical retry and rejects command ID reuse", async () => {
    const command = {
      commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(),
      actorId: "sane", type: "CreateGoal", expectedVersion: 0,
    } as const;
    const first = await executeGoalCommand(pool, command);
    await expect(executeGoalCommand(pool, command)).resolves.toEqual(first);
    await expect(executeGoalCommand(pool, { ...command, actorId: "other" })).rejects.toBeInstanceOf(CommandIdReuseError);
    const counts = await pool.query("SELECT (SELECT count(*)::int FROM command_receipts) receipts, (SELECT count(*)::int FROM goal_events) events, (SELECT count(*)::int FROM outbox) outbox");
    expect(counts.rows[0]).toEqual({ receipts: 1, events: 1, outbox: 1 });
  });

  it("allows only one command at an expected Goal version", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0 });
    const base = { projectId, goalId, actorId: "head", type: "TransitionGoal", expectedVersion: 1 } as const;
    const [a, b] = await Promise.all([
      executeGoalCommand(pool, { ...base, commandId: randomUUID(), to: "ready_for_confirmation" }),
      executeGoalCommand(pool, { ...base, commandId: randomUUID(), to: "recovering" }),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["succeeded", "version_conflict"]);
    const goal = await pool.query("SELECT version::int, state FROM goals WHERE goal_id = $1", [goalId]);
    expect(goal.rows[0].version).toBe(2);
    const counts = await pool.query("SELECT (SELECT count(*)::int FROM command_receipts) receipts, (SELECT count(*)::int FROM goal_events) events, (SELECT count(*)::int FROM outbox) outbox");
    expect(counts.rows[0]).toEqual({ receipts: 3, events: 2, outbox: 2 });
  });
});
