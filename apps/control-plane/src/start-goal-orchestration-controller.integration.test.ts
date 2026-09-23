import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHeadActivationPlan, deriveHeadActivationCommandId } from "@maestro/domain";
import { applyAllMigrations } from "@maestro/persistence";
import { createStartGoalOrchestrationController } from "./start-goal-orchestration-controller.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("start_goal orchestration controller", () => {
  const schema = `start_goal_controller_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const scopedUrl = (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })();
  const pool = new Pool({ connectionString: scopedUrl });
  let projectId: string;
  let goalId: string;
  let taskContractId: string;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE goal_orchestration_history, goal_orchestration_runs, goals, task_contracts CASCADE");
    projectId = randomUUID();
    goalId = randomUUID();
    taskContractId = randomUUID();
  });
  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  async function seed(command: Record<string, unknown>, plan: unknown): Promise<void> {
    await pool.query(
      "INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')",
      [taskContractId, JSON.stringify({ project: { projectId }, headActivationPlan: plan }), "a".repeat(64)],
    );
    await pool.query(
      "INSERT INTO goals (goal_id, project_id, task_contract_id, state, version, created_at, updated_at) VALUES ($1, $2, $3, 'draft', 1, transaction_timestamp(), transaction_timestamp())",
      [goalId, projectId, taskContractId],
    );
  }

  function command(plan?: ReturnType<typeof createHeadActivationPlan>, actorId = "operator-1") {
    return {
      eventId: randomUUID(),
      commandId: randomUUID(),
      type: "start_goal" as const,
      projectId,
      goalId,
      taskContractId,
      actorId,
      contentHash: "a".repeat(64),
      ...(plan === undefined ? {} : { headActivationPlan: plan }),
    };
  }

  it("durably blocks a missing explicit plan", async () => {
    const input = command();
    await seed(input, undefined);
    const goalService = {
      getGoal: async () => ({ goalId, projectId, contractId: taskContractId, state: "draft" as const, version: 1 }),
      transitionGoal: async () => {
        throw new Error("must not transition");
      },
    };
    const headParticipationService = {
      activate: async () => {
        throw new Error("must not activate");
      },
    };
    const controller = createStartGoalOrchestrationController({ pool, goalService, headParticipationService } as never);

    await expect(controller.execute(input)).resolves.toMatchObject({ state: "blocked", reason: "missing_head_activation_plan" });
    expect((await pool.query("SELECT state, reason FROM goal_orchestration_runs WHERE goal_id = $1", [goalId])).rows).toEqual([
      { state: "blocked", reason: "missing_head_activation_plan" },
    ]);
  });

  it("advances the lifecycle, activates explicit departments, and replays without duplicate effects", async () => {
    const plan = createHeadActivationPlan({
      version: 1,
      departments: [
        {
          departmentId: "product",
          requestedContribution: "boundary",
          urgency: "normal",
          contextScope: ["contract"],
          budgetEffect: "none",
          reason: "needed",
        },
      ],
    });
    const input = command(plan);
    await seed(input, plan);
    let goal = {
      goalId,
      projectId,
      contractId: taskContractId,
      state: "draft" as "draft" | "ready_for_confirmation" | "launched" | "active",
      version: 1,
    };
    const transitions: string[] = [];
    const activations: string[] = [];
    const goalService = {
      getGoal: async () => goal,
      transitionGoal: async (_goalId: string, transition: { to: typeof goal.state }) => {
        transitions.push(transition.to);
        goal = { ...goal, state: transition.to, version: goal.version + 1 };
        return goal;
      },
    };
    const headParticipationService = {
      activate: async (_goalId: string, _input: unknown, _operator: unknown, commandId: string) => {
        activations.push(commandId);
        return {
          goalId,
          departmentId: "product",
          headRoleId: "head:product",
          contractId: taskContractId,
          contextId: null,
          status: "active" as const,
          activeSessionRef: "session-1",
        };
      },
    };
    const controller = createStartGoalOrchestrationController({ pool, goalService, headParticipationService } as never);

    await expect(controller.execute(input)).resolves.toMatchObject({ state: "completed" });
    await expect(controller.execute(input)).resolves.toMatchObject({ state: "completed" });
    expect(transitions).toEqual(["ready_for_confirmation", "launched", "active"]);
    expect(activations).toEqual([deriveHeadActivationCommandId(input.commandId, "product")]);
    expect((await pool.query("SELECT state, reason FROM goal_orchestration_runs WHERE goal_id = $1", [goalId])).rows).toEqual([
      { state: "completed", reason: "head_activation_complete" },
    ]);
  });
});
