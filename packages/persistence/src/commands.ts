import { createHash, randomUUID } from "node:crypto";
import { InvalidGoalTransitionError, assertValidTaskContractSubstance, taskContractContentHash, transitionGoal, type GoalState, type TaskContractSubstance } from "@maestro/domain";
import type { Pool } from "pg";
import { assertProjectRole } from "./project-membership.js";

export interface GoalLeaseProof {
  goalId: string;
  ownerId: string;
  /** Exact base-10 PostgreSQL bigint text. Never convert this to a JS number. */
  fencingToken: string;
}

export interface AcquireGoalLeaseRequest {
  goalId: string;
  ownerId: string;
  leaseDurationMs: number;
}

export class LeaseUnavailableError extends Error {
  constructor(goalId: string) {
    super(`Goal lease is currently held: ${goalId}`);
    this.name = "LeaseUnavailableError";
  }
}

export class StaleGoalLeaseError extends Error {
  readonly code = "stale_lease";

  constructor(goalId: string) {
    super(`Goal lease proof is stale or invalid: ${goalId}`);
    this.name = "StaleGoalLeaseError";
  }
}

export type GoalCommand =
  | { commandId: string; projectId: string; goalId: string; actorId: string; type: "CreateGoal"; expectedVersion: 0; contractId?: string; requiredRole?: string }
  | { commandId: string; projectId: string; goalId: string; actorId: string; type: "TransitionGoal"; expectedVersion: number; to: GoalState; requiredRole?: string }
  /** Emergency stop is a narrow terminal command, not an arbitrary transition. */
  | { commandId: string; projectId: string; goalId: string; actorId: string; type: "EmergencyStopGoal"; expectedVersion: number; requiredRole?: string };

export interface CommandResult {
  outcome: "succeeded" | "version_conflict" | "rejected";
  goalId: string;
  version?: number;
  state?: GoalState;
  eventId?: string;
  contractId?: string;
  code?: string;
  expectedVersion?: number;
  actualVersion?: number;
}

export class CommandIdReuseError extends Error {
  constructor(commandId: string) {
    super(`Command ID reused with different content: ${commandId}`);
    this.name = "CommandIdReuseError";
  }
}

/**
 * Test-only checkpoint. It is intentionally an explicit call-site dependency,
 * never read from configuration or installed by an application composition root.
 */
export interface ExecuteGoalCommandTestHooks {
  /** Runs after all durable writes and before the transaction commits. */
  beforeCommit?(): void | Promise<void>;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function commandHash(command: GoalCommand): Buffer {
  return createHash("sha256").update(canonicalJson(command)).digest();
}

export async function acquireGoalLease(
  pool: Pool,
  request: AcquireGoalLeaseRequest,
): Promise<GoalLeaseProof> {
  if (!Number.isSafeInteger(request.leaseDurationMs) || request.leaseDurationMs <= 0) {
    throw new RangeError("leaseDurationMs must be a positive safe integer");
  }
  const result = await pool.query<{ goal_id: string; owner_id: string; fencing_token: string }>(
    `INSERT INTO goal_leases (goal_id, owner_id, fencing_token, expires_at)
     VALUES ($1, $2, 1, transaction_timestamp() + ($3 * interval '1 millisecond'))
     ON CONFLICT (goal_id) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           fencing_token = goal_leases.fencing_token + 1,
           expires_at = transaction_timestamp() + ($3 * interval '1 millisecond'),
           updated_at = transaction_timestamp()
       WHERE goal_leases.expires_at <= transaction_timestamp()
     RETURNING goal_id, owner_id, fencing_token`,
    [request.goalId, request.ownerId, request.leaseDurationMs],
  );
  if (result.rowCount !== 1) throw new LeaseUnavailableError(request.goalId);
  const row = result.rows[0]!;
  return { goalId: row.goal_id, ownerId: row.owner_id, fencingToken: row.fencing_token };
}

/**
 * Extend a lease only when this exact proof is still current. The UPDATE is
 * atomic and deliberately leaves fencing_token unchanged.
 */
export async function renewGoalLease(
  pool: Pool,
  proof: GoalLeaseProof,
  leaseDurationMs: number,
): Promise<GoalLeaseProof> {
  if (!isValidLeaseProof(proof) || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new StaleGoalLeaseError(proof.goalId);
  }
  const result = await pool.query<{ goal_id: string; owner_id: string; fencing_token: string }>(
    `UPDATE goal_leases
     SET expires_at = transaction_timestamp() + ($4 * interval '1 millisecond'),
         updated_at = transaction_timestamp()
     WHERE goal_id = $1
       AND owner_id = $2
       AND fencing_token = $3::bigint
       AND expires_at > transaction_timestamp()
     RETURNING goal_id, owner_id, fencing_token`,
    [proof.goalId, proof.ownerId, proof.fencingToken, leaseDurationMs],
  );
  if (result.rowCount !== 1) throw new StaleGoalLeaseError(proof.goalId);
  const row = result.rows[0]!;
  return { goalId: row.goal_id, ownerId: row.owner_id, fencingToken: row.fencing_token };
}

export async function executeGoalCommand(
  pool: Pool,
  command: GoalCommand,
  proof: GoalLeaseProof,
  testHooks?: ExecuteGoalCommandTestHooks,
): Promise<CommandResult> {
  if (proof.goalId !== command.goalId || !isValidLeaseProof(proof)) {
    throw new StaleGoalLeaseError(command.goalId);
  }
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await assertCurrentGoalLease(client, command, proof);
    if (command.requiredRole !== undefined) await assertProjectRole(client, command.actorId, command.projectId, command.requiredRole);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))", [command.commandId]);

    const hash = commandHash(command);
    const prior = await client.query<{ request_hash: Buffer; request: unknown; result: CommandResult }>(
      "SELECT request_hash, request, result FROM command_receipts WHERE command_id = $1",
      [command.commandId],
    );
    if (prior.rowCount === 1) {
      const row = prior.rows[0]!;
      await client.query("COMMIT");
      transactionOpen = false;
      if (!row.request_hash.equals(hash) || canonicalJson(row.request) !== canonicalJson(command)) {
        throw new CommandIdReuseError(command.commandId);
      }
      return row.result;
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 2))", [command.goalId]);
    const current = await client.query<{ project_id: string; state: GoalState; version: string; created_at: Date }>(
      "SELECT project_id, state, version, created_at FROM goals WHERE goal_id = $1 AND project_id = $2 FOR UPDATE",
      [command.goalId, command.projectId],
    );
    const actualVersion = current.rowCount === 1 ? Number(current.rows[0]!.version) : 0;

    if (actualVersion !== command.expectedVersion) {
      const result: CommandResult = {
        outcome: "version_conflict",
        goalId: command.goalId,
        code: "version_conflict",
        expectedVersion: command.expectedVersion,
        actualVersion,
      };
      await insertReceipt(client, command, hash, "version_conflict", result);
      await client.query("COMMIT");
      transactionOpen = false;
      return result;
    }

    if (command.type === "CreateGoal" && command.contractId !== undefined) {
      const contract = await client.query<{ launch_state: string; project_id: string; content: TaskContractSubstance; content_hash: string }>(
        "SELECT launch_state, content->'project'->>'projectId' AS project_id, content, content_hash FROM task_contracts WHERE contract_id = $1 FOR KEY SHARE",
        [command.contractId],
      );
      let code: string | undefined;
      if (contract.rowCount === 0) code = "task_contract_not_found";
      else {
        const stored = contract.rows[0]!;
        try {
          assertValidTaskContractSubstance(stored.content);
          if (taskContractContentHash(stored.content) !== stored.content_hash.trim()) code = "task_contract_integrity_error";
        } catch {
          code = "task_contract_integrity_error";
        }
        if (code === undefined && stored.project_id !== command.projectId) code = "task_contract_project_mismatch";
        if (code === undefined && stored.launch_state !== "launched") code = "task_contract_not_launched";
      }
      if (code !== undefined) {
        const result: CommandResult = { outcome: "rejected", goalId: command.goalId, code };
        await insertReceipt(client, command, hash, "rejected", result);
        await client.query("COMMIT");
        transactionOpen = false;
        return result;
      }
    }

    let nextState: GoalState;
    let eventType: string;
    if (command.type === "CreateGoal") {
      if (actualVersion !== 0) throw new Error("CreateGoal invariant violated");
      nextState = "draft";
      eventType = "GoalCreated";
    } else {
      if (current.rowCount !== 1) {
        const result: CommandResult = { outcome: "rejected", goalId: command.goalId, code: "goal_not_found" };
        await insertReceipt(client, command, hash, "rejected", result);
        await client.query("COMMIT");
        transactionOpen = false;
        return result;
      }
      if (command.type === "EmergencyStopGoal") {
        if (["stopped", "succeeded", "failed"].includes(current.rows[0]!.state)) {
          const result: CommandResult = { outcome: "rejected", goalId: command.goalId, code: "invalid_transition" };
          await insertReceipt(client, command, hash, "rejected", result);
          await client.query("COMMIT");
          transactionOpen = false;
          return result;
        }
        nextState = "stopped";
        eventType = "GoalEmergencyStopped";
      } else {
        try {
          nextState = transitionGoal(current.rows[0]!.state, command.to);
        } catch (error) {
          if (!(error instanceof InvalidGoalTransitionError)) throw error;
          const result: CommandResult = { outcome: "rejected", goalId: command.goalId, code: "invalid_transition" };
          await insertReceipt(client, command, hash, "rejected", result);
          await client.query("COMMIT");
          transactionOpen = false;
          return result;
        }
        eventType = "GoalTransitioned";
      }
    }

    if (command.type !== "CreateGoal") {
      try {
        await applyGoalControlTransition(client, command, current.rows[0]!.state, nextState);
      } catch (error) {
        if (!(error instanceof InvalidGoalTransitionError)) throw error;
        const result: CommandResult = { outcome: "rejected", goalId: command.goalId, code: "invalid_transition" };
        await insertReceipt(client, command, hash, "rejected", result);
        await client.query("COMMIT");
        transactionOpen = false;
        return result;
      }
    }

    const nextVersion = command.expectedVersion + 1;
    const eventId = randomUUID();
    const result: CommandResult = {
      outcome: "succeeded", goalId: command.goalId, version: nextVersion,
      state: nextState, eventId,
      ...(command.type === "CreateGoal" && command.contractId !== undefined ? { contractId: command.contractId } : {}),
    };
    await insertReceipt(client, command, hash, "succeeded", result);
    await client.query(
      `INSERT INTO goal_events
       (event_id, project_id, goal_id, aggregate_version, event_type, schema_version, payload, command_id)
       VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7)`,
      [eventId, command.projectId, command.goalId, nextVersion, eventType, JSON.stringify({ state: nextState, ...(command.type === "CreateGoal" && command.contractId !== undefined ? { taskContractId: command.contractId } : {}) }), command.commandId],
    );

    if (command.type === "CreateGoal") {
      await client.query(
        `INSERT INTO goals (goal_id, project_id, state, version, task_contract_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, transaction_timestamp(), transaction_timestamp())`,
        [command.goalId, command.projectId, nextState, nextVersion, command.contractId ?? null],
      );
      await client.query(
        `INSERT INTO goal_controls (project_id, goal_id) VALUES ($1, $2)`,
        [command.projectId, command.goalId],
      );
    } else {
      const updated = await client.query(
        `UPDATE goals SET state = $1, version = $2, updated_at = transaction_timestamp()
         WHERE goal_id = $3 AND project_id = $4 AND version = $5`,
        [nextState, nextVersion, command.goalId, command.projectId, command.expectedVersion],
      );
      if (updated.rowCount !== 1) throw new Error("Goal projection invariant violated");
    }

    await client.query(
      `INSERT INTO outbox (event_id, topic, payload)
       VALUES ($1, 'goal-events', $2::jsonb)`,
      [eventId, JSON.stringify({ eventId })],
    );
    await client.query("SELECT pg_notify('maestro_outbox', $1)", [eventId]);
    await testHooks?.beforeCommit?.();
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


type StoredGoalControlForTransition = {
  emergency_stopped_at: Date | null;
  pause_requested_at: Date | null;
  paused_at: Date | null;
  stopping_at: Date | null;
  stopped_at: Date | null;
};

type ControlModeForTransition = "emergency_stopped" | "stopped" | "stopping" | "paused" | "pause_requested" | "open";

function controlModeForTransition(control: StoredGoalControlForTransition): ControlModeForTransition {
  if (control.emergency_stopped_at !== null) return "emergency_stopped";
  if (control.stopped_at !== null) return "stopped";
  if (control.stopping_at !== null) return "stopping";
  if (control.paused_at !== null) return "paused";
  if (control.pause_requested_at !== null) return "pause_requested";
  return "open";
}

/**
 * Couple every Goal lifecycle transition to its durable control latch while
 * holding both rows in the command transaction. This prevents a caller from
 * moving the projection to a pause/stop/resume state without fencing effects.
 */
async function applyGoalControlTransition(
  client: { query: <T>(text: string, values?: readonly unknown[]) => Promise<{ rowCount: number | null; rows: T[] }> },
  command: Extract<GoalCommand, { type: "TransitionGoal" | "EmergencyStopGoal" }>,
  from: GoalState,
  to: GoalState,
): Promise<void> {
  await client.query(
    `INSERT INTO goal_controls (project_id, goal_id) VALUES ($1, $2)
     ON CONFLICT (project_id, goal_id) DO NOTHING`,
    [command.projectId, command.goalId],
  );
  const result = await client.query<StoredGoalControlForTransition>(
    `SELECT emergency_stopped_at, pause_requested_at, paused_at, stopping_at, stopped_at
       FROM goal_controls WHERE project_id = $1 AND goal_id = $2 FOR UPDATE`,
    [command.projectId, command.goalId],
  );
  if (result.rowCount !== 1) throw new Error("Goal control invariant violated");
  const mode = controlModeForTransition(result.rows[0]!);
  const update = async (sql: string, values: readonly unknown[] = [command.projectId, command.goalId]) => {
    await client.query(sql, values);
  };

  if (command.type === "EmergencyStopGoal") {
    if (mode === "emergency_stopped") return;
    await update(
      `UPDATE goal_controls
          SET control_epoch = control_epoch + 1,
              emergency_stopped_at = transaction_timestamp(),
              stopping_at = COALESCE(stopping_at, transaction_timestamp()),
              stopped_at = COALESCE(stopped_at, transaction_timestamp())
        WHERE project_id = $1 AND goal_id = $2`,
    );
    await client.query(
      `UPDATE authority_records SET revoked_at = transaction_timestamp()
        WHERE project_id = $1 AND goal_id = $2 AND revoked_at IS NULL`,
      [command.projectId, command.goalId],
    );
    return;
  }

  if (to === "pausing") {
    if (mode === "pause_requested") return;
    if (mode !== "open" || from !== "active") throw new InvalidGoalTransitionError(from, to);
    await update(
      `UPDATE goal_controls SET control_epoch = control_epoch + 1, pause_requested_at = transaction_timestamp()
        WHERE project_id = $1 AND goal_id = $2`,
    );
    return;
  }
  if (to === "paused") {
    if (mode === "paused") return;
    if (mode === "pause_requested" && from === "pausing") {
      await update(
        `UPDATE goal_controls SET control_epoch = control_epoch + 1, paused_at = transaction_timestamp()
          WHERE project_id = $1 AND goal_id = $2`,
      );
      return;
    }
    // Recovery may restore a durably known paused Goal in one atomic write;
    // both timestamps are required so effects stay fenced throughout it.
    if (mode === "open" && from === "recovering") {
      await update(
        `UPDATE goal_controls
            SET control_epoch = control_epoch + 1,
                pause_requested_at = transaction_timestamp(),
                paused_at = transaction_timestamp()
          WHERE project_id = $1 AND goal_id = $2`,
      );
      return;
    }
    throw new InvalidGoalTransitionError(from, to);
  }
  if (to === "resuming") {
    if (mode !== "paused" || from !== "paused") throw new InvalidGoalTransitionError(from, to);
    await update(
      `UPDATE goal_controls SET control_epoch = control_epoch + 1, pause_requested_at = NULL, paused_at = NULL
        WHERE project_id = $1 AND goal_id = $2`,
    );
    return;
  }
  if (to === "stopping") {
    if (mode === "stopping") return;
    const validSource = from === "active" || from === "paused";
    if (!validSource || !["open", "pause_requested", "paused"].includes(mode)) {
      throw new InvalidGoalTransitionError(from, to);
    }
    await update(
      `UPDATE goal_controls SET control_epoch = control_epoch + 1, stopping_at = transaction_timestamp()
        WHERE project_id = $1 AND goal_id = $2`,
    );
    return;
  }
  if (to === "stopped") {
    if (mode === "stopped") return;
    if (from !== "stopping" && from !== "blocked" && from !== "recovering") {
      throw new InvalidGoalTransitionError(from, to);
    }
    await update(
      `UPDATE goal_controls
          SET control_epoch = control_epoch + 1,
              stopping_at = COALESCE(stopping_at, transaction_timestamp()),
              stopped_at = transaction_timestamp()
        WHERE project_id = $1 AND goal_id = $2`,
    );
    await client.query(
      `UPDATE authority_records SET revoked_at = transaction_timestamp()
        WHERE project_id = $1 AND goal_id = $2 AND revoked_at IS NULL`,
      [command.projectId, command.goalId],
    );
    return;
  }

  // Recovery may explicitly clear an interrupted pause before re-entering
  // execution. Stop and emergency latches remain terminal and cannot be
  // bypassed by a generic transition.
  if (to === "active" && from === "recovering" && (mode === "paused" || mode === "pause_requested")) {
    await update(
      `UPDATE goal_controls SET control_epoch = control_epoch + 1, pause_requested_at = NULL, paused_at = NULL
        WHERE project_id = $1 AND goal_id = $2`,
    );
    return;
  }
  if (["emergency_stopped", "stopped", "stopping", "paused", "pause_requested"].includes(mode) &&
      (to === "active" || to === "certifying" || to === "succeeded" || to === "failed")) {
    throw new InvalidGoalTransitionError(from, to);
  }
}

async function assertCurrentGoalLease(
  client: { query: <T>(text: string, values?: readonly unknown[]) => Promise<{ rowCount: number | null; rows: T[] }> },
  command: GoalCommand,
  proof: GoalLeaseProof,
): Promise<void> {
  if (proof.goalId !== command.goalId || !isValidLeaseProof(proof)) {
    throw new StaleGoalLeaseError(command.goalId);
  }
  const lease = await client.query<{ goal_id: string }>(
    `SELECT goal_id
     FROM goal_leases
     WHERE goal_id = $1
       AND owner_id = $2
       AND fencing_token = $3::bigint
       AND expires_at > transaction_timestamp()
     FOR UPDATE`,
    [command.goalId, proof.ownerId, proof.fencingToken],
  );
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(command.goalId);
}

function isValidLeaseProof(proof: GoalLeaseProof): boolean {
  return proof.goalId !== "" && proof.ownerId !== "" && isValidFencingToken(proof.fencingToken);
}

/**
 * Structural bounds check for an exact base-10 PostgreSQL signed bigint
 * fencing token. Shared by every lease kind (per-Goal and reconciliation
 * leader) so none of them ever coerce a token through a JS number.
 */
export function isValidFencingToken(fencingToken: string): boolean {
  const maxFencingToken = "9223372036854775807";
  return typeof fencingToken === "string" &&
    /^[1-9][0-9]*$/.test(fencingToken) &&
    (fencingToken.length < maxFencingToken.length ||
      (fencingToken.length === maxFencingToken.length && fencingToken <= maxFencingToken));
}

async function insertReceipt(
  client: { query: (text: string, values?: readonly unknown[]) => Promise<unknown> },
  command: GoalCommand,
  hash: Buffer,
  outcome: CommandResult["outcome"],
  result: CommandResult,
): Promise<void> {
  await client.query(
    `INSERT INTO command_receipts
     (command_id, project_id, goal_id, actor_id, command_type, expected_version, request_hash, request, outcome, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb)`,
    [command.commandId, command.projectId, command.goalId, command.actorId, command.type,
      command.expectedVersion, hash, JSON.stringify(command), outcome, JSON.stringify(result)],
  );
}
