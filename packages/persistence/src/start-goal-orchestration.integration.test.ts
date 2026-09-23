import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { beginStartGoalOrchestration, readStartGoalOrchestration, recordStartGoalOrchestrationState } from "./start-goal-orchestration.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("durable start_goal orchestration state", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let projectId: string;
  let goalId: string;
  let taskContractId: string;

  beforeAll(async () => {
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE goal_orchestration_history, goal_orchestration_runs, goals, goal_controls, goal_leases CASCADE");
    projectId = randomUUID();
    goalId = randomUUID();
    taskContractId = randomUUID();
    await pool.query(
      "INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')",
      [taskContractId, JSON.stringify({ project: { projectId } }), "a".repeat(64)],
    );
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, task_contract_id, state, version, created_at, updated_at) VALUES ($1, $2, $3, 'draft', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId, taskContractId],
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  it("creates one running record and replays the exact start command", async () => {
    const command = {
      eventId: randomUUID(),
      commandId: randomUUID(),
      type: "start_goal" as const,
      projectId,
      goalId,
      taskContractId,
      actorId: "operator-1",
      contentHash: "a".repeat(64),
    };
    await expect(beginStartGoalOrchestration(pool, command, "b".repeat(64))).resolves.toMatchObject({
      state: "running",
      stage: "head_activation",
      headActivationPlanHash: "b".repeat(64),
    });
    await expect(beginStartGoalOrchestration(pool, command, "b".repeat(64))).resolves.toMatchObject({ state: "running" });
    await expect(readStartGoalOrchestration(pool, goalId)).resolves.toMatchObject({
      goalId,
      projectId,
      taskContractId: command.taskContractId,
      startCommandId: command.commandId,
    });
  });

  it("rejects a changed replay and records append-only blocked state once per event key", async () => {
    const command = {
      eventId: randomUUID(),
      commandId: randomUUID(),
      type: "start_goal" as const,
      projectId,
      goalId,
      taskContractId,
      actorId: "operator-1",
      contentHash: "a".repeat(64),
    };
    await beginStartGoalOrchestration(pool, command, null);
    await expect(beginStartGoalOrchestration(pool, { ...command, actorId: "operator-2" }, null)).rejects.toThrow("binding");
    await recordStartGoalOrchestrationState(pool, {
      goalId,
      commandId: command.commandId,
      eventKey: `${command.commandId}:missing-plan`,
      state: "blocked",
      reason: "missing_head_activation_plan",
    });
    await expect(
      recordStartGoalOrchestrationState(pool, {
        goalId,
        commandId: command.commandId,
        eventKey: `${command.commandId}:missing-plan`,
        state: "unknown",
        reason: "changed",
      }),
    ).rejects.toThrow("binding");
    await expect(
      recordStartGoalOrchestrationState(pool, {
        goalId,
        commandId: command.commandId,
        eventKey: `${command.commandId}:late`,
        state: "completed",
        reason: "late",
      }),
    ).rejects.toThrow("binding");
    expect((await pool.query("SELECT state, reason FROM goal_orchestration_runs WHERE goal_id = $1", [goalId])).rows).toEqual([
      { state: "blocked", reason: "missing_head_activation_plan" },
    ]);
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM goal_orchestration_history WHERE goal_id = $1", [goalId])).rows[0]!.count,
    ).toBe(2);
  });
});
