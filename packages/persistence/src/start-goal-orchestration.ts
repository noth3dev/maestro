import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ValidatedStartGoalOrchestrationCommand } from "./commands.js";

export type StartGoalOrchestrationState = "running" | "blocked" | "unknown" | "completed";
export type StartGoalOrchestrationStage = "head_activation" | "council_creation" | "briefs_pending";

export type StartGoalOrchestrationInput = Omit<ValidatedStartGoalOrchestrationCommand, "actorId"> & {
  actorId: string | null;
  headActivationPlanHash: string | null;
};

export interface StartGoalOrchestrationRun {
  readonly goalId: string;
  readonly projectId: string;
  readonly taskContractId: string;
  readonly startCommandId: string;
  readonly actorId: string | null;
  readonly stage: StartGoalOrchestrationStage;
  readonly state: StartGoalOrchestrationState;
  readonly headActivationPlanHash: string | null;
  readonly reason: string;
}

export interface StartGoalOrchestrationStateInput {
  readonly goalId: string;
  readonly commandId: string;
  readonly eventKey: string;
  readonly stage?: StartGoalOrchestrationStage;
  readonly state: StartGoalOrchestrationState;
  readonly reason: string;
  readonly details?: Record<string, unknown>;
}

export class StartGoalOrchestrationBindingError extends Error {
  readonly code = "start_goal_orchestration_binding_conflict";
  constructor() {
    super("Start Goal orchestration binding does not match durable state");
    this.name = "StartGoalOrchestrationBindingError";
  }
}

type RunRow = {
  goal_id: string;
  project_id: string;
  task_contract_id: string;
  start_command_id: string;
  actor_id: string | null;
  stage: StartGoalOrchestrationStage;
  state: StartGoalOrchestrationState;
  head_activation_plan_hash: string | null;
  reason: string;
};
type Queryable = Pick<Pool | PoolClient, "query">;

export async function beginStartGoalOrchestration(
  pool: Pool,
  input: StartGoalOrchestrationInput,
  planHash: string | null,
): Promise<StartGoalOrchestrationRun> {
  assertHash(planHash);
  if (input.headActivationPlan !== undefined && input.headActivationPlan.contentHash !== planHash)
    throw new StartGoalOrchestrationBindingError();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const binding = await client.query(
      `SELECT 1
         FROM goals g
         JOIN task_contracts tc ON tc.contract_id = $3
        WHERE g.goal_id = $1
          AND g.project_id = $2
          AND g.task_contract_id = $3
          AND tc.launch_state = 'launched'
          AND tc.content #>> '{project,projectId}' = $2::text
        FOR KEY SHARE OF g, tc`,
      [input.goalId, input.projectId, input.taskContractId],
    );
    if (binding.rowCount !== 1) throw new StartGoalOrchestrationBindingError();
    const inserted = await client.query(
      `INSERT INTO goal_orchestration_runs
        (goal_id, project_id, task_contract_id, start_command_id, actor_id, stage, state, head_activation_plan_hash, reason)
       VALUES ($1, $2, $3, $4, $5, 'head_activation', 'running', $6, 'start_goal claimed')
       ON CONFLICT (goal_id) DO NOTHING`,
      [input.goalId, input.projectId, input.taskContractId, input.commandId, input.actorId, planHash],
    );
    const result = await client.query<RunRow>(
      `SELECT goal_id, project_id, task_contract_id, start_command_id, actor_id, stage, state, head_activation_plan_hash, reason
         FROM goal_orchestration_runs WHERE goal_id = $1 FOR UPDATE`,
      [input.goalId],
    );
    const row = result.rows[0];
    if (
      result.rowCount !== 1 ||
      row === undefined ||
      row.project_id !== input.projectId ||
      row.task_contract_id !== input.taskContractId ||
      row.start_command_id !== input.commandId ||
      row.actor_id !== input.actorId ||
      row.head_activation_plan_hash !== planHash
    ) {
      throw new StartGoalOrchestrationBindingError();
    }
    if (inserted.rowCount === 1) {
      await appendHistory(client, {
        goalId: input.goalId,
        commandId: input.commandId,
        eventKey: `${input.commandId}:started`,
        stage: "head_activation",
        state: "running",
        reason: "start_goal claimed",
      });
    }
    await client.query("COMMIT");
    return toRun(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordStartGoalOrchestrationState(
  pool: Pool,
  input: StartGoalOrchestrationStateInput,
): Promise<StartGoalOrchestrationRun> {
  if (input.reason.trim() === "" || input.eventKey.trim() === "") throw new StartGoalOrchestrationBindingError();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<RunRow>(
      `SELECT goal_id, project_id, task_contract_id, start_command_id, actor_id, stage, state, head_activation_plan_hash, reason
         FROM goal_orchestration_runs WHERE goal_id = $1 FOR UPDATE`,
      [input.goalId],
    );
    const row = current.rows[0];
    if (current.rowCount !== 1 || row === undefined || row.start_command_id !== input.commandId)
      throw new StartGoalOrchestrationBindingError();
    const stage = input.stage ?? row.stage;
    const historyInserted = await appendHistory(client, { ...input, stage });
    const terminal = row.state === "blocked" || row.state === "unknown" || row.state === "completed";
    if (terminal && historyInserted) throw new StartGoalOrchestrationBindingError();
    if (!terminal) {
      await client.query(
        `UPDATE goal_orchestration_runs SET stage = $2, state = $3, reason = $4, updated_at = transaction_timestamp() WHERE goal_id = $1`,
        [input.goalId, stage, input.state, input.reason],
      );
    }
    const updated = await client.query<RunRow>(
      `SELECT goal_id, project_id, task_contract_id, start_command_id, actor_id, stage, state, head_activation_plan_hash, reason
         FROM goal_orchestration_runs WHERE goal_id = $1`,
      [input.goalId],
    );
    await client.query("COMMIT");
    return toRun(updated.rows[0]!);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readStartGoalOrchestration(pool: Queryable, goalId: string): Promise<StartGoalOrchestrationRun | undefined> {
  const result = await pool.query<RunRow>(
    `SELECT goal_id, project_id, task_contract_id, start_command_id, actor_id, stage, state, head_activation_plan_hash, reason
       FROM goal_orchestration_runs WHERE goal_id = $1`,
    [goalId],
  );
  return result.rows[0] === undefined ? undefined : toRun(result.rows[0]!);
}

async function appendHistory(
  client: PoolClient,
  input: StartGoalOrchestrationStateInput & { readonly stage: StartGoalOrchestrationStage },
): Promise<boolean> {
  const details = JSON.stringify(input.details ?? {});
  const inserted = await client.query(
    `INSERT INTO goal_orchestration_history
      (history_id, goal_id, command_id, event_key, stage, state, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (goal_id, event_key) DO NOTHING
     RETURNING history_id`,
    [randomUUID(), input.goalId, input.commandId, input.eventKey, input.stage, input.state, input.reason, details],
  );
  if (inserted.rowCount === 1) return true;
  const exact = await client.query(
    `SELECT 1
       FROM goal_orchestration_history
      WHERE goal_id = $1 AND event_key = $2 AND command_id = $3 AND stage = $4
        AND state = $5 AND reason = $6 AND details = $7::jsonb`,
    [input.goalId, input.eventKey, input.commandId, input.stage, input.state, input.reason, details],
  );
  if (exact.rowCount !== 1) throw new StartGoalOrchestrationBindingError();
  return false;
}

function toRun(row: RunRow): StartGoalOrchestrationRun {
  return {
    goalId: row.goal_id,
    projectId: row.project_id,
    taskContractId: row.task_contract_id,
    startCommandId: row.start_command_id,
    actorId: row.actor_id,
    stage: row.stage,
    state: row.state,
    headActivationPlanHash: row.head_activation_plan_hash?.trim() ?? null,
    reason: row.reason,
  };
}
function assertHash(value: string | null): void {
  if (value !== null && !/^[a-f0-9]{64}$/.test(value)) throw new StartGoalOrchestrationBindingError();
}
