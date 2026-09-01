import { createHash, randomUUID } from "node:crypto";
import { InvalidGoalTransitionError, transitionGoal, type GoalState } from "@maestro/domain";
import type { Pool } from "pg";

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
  | { commandId: string; projectId: string; goalId: string; actorId: string; type: "CreateGoal"; expectedVersion: 0 }
  | { commandId: string; projectId: string; goalId: string; actorId: string; type: "TransitionGoal"; expectedVersion: number; to: GoalState };

export interface CommandResult {
  outcome: "succeeded" | "version_conflict" | "rejected";
  goalId: string;
  version?: number;
  state?: GoalState;
  eventId?: string;
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
      "SELECT project_id, state, version, created_at FROM goals WHERE goal_id = $1 FOR UPDATE",
      [command.goalId],
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

    const nextVersion = command.expectedVersion + 1;
    const eventId = randomUUID();
    const result: CommandResult = {
      outcome: "succeeded", goalId: command.goalId, version: nextVersion,
      state: nextState, eventId,
    };
    await insertReceipt(client, command, hash, "succeeded", result);
    await client.query(
      `INSERT INTO goal_events
       (event_id, project_id, goal_id, aggregate_version, event_type, schema_version, payload, command_id)
       VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7)`,
      [eventId, command.projectId, command.goalId, nextVersion, eventType, JSON.stringify({ state: nextState }), command.commandId],
    );

    if (command.type === "CreateGoal") {
      await client.query(
        `INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, transaction_timestamp(), transaction_timestamp())`,
        [command.goalId, command.projectId, nextState, nextVersion],
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
  const maxFencingToken = "9223372036854775807";
  return proof.goalId !== "" && proof.ownerId !== "" &&
    typeof proof.fencingToken === "string" &&
    /^[1-9][0-9]*$/.test(proof.fencingToken) &&
    (proof.fencingToken.length < maxFencingToken.length ||
      (proof.fencingToken.length === maxFencingToken.length && proof.fencingToken <= maxFencingToken));
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
