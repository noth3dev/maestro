import { createHash, randomUUID } from "node:crypto";
import { assertValidPortfolioCouncilDecision, canonicalJson, requiresImmediateSafePause, type PortfolioCouncilDecision, type PortfolioExecutionFence } from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import { assertGoalControlOpen } from "./council.js";

export class PortfolioCouncilPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioCouncilPersistenceError";
  }
}

export class PortfolioCouncilDecisionNotFoundError extends PortfolioCouncilPersistenceError {}

export interface RecordPortfolioCouncilDecisionInput {
  readonly projectId: string;
  readonly decision: PortfolioCouncilDecision;
  readonly actorId: string;
  readonly sessionRef: string;
  /** One current lease proof for every captured Goal. */
  readonly goalProofs: readonly GoalLeaseProof[];
}

export interface PortfolioCouncilDecisionRecord extends PortfolioCouncilDecision {
  readonly roundId: string;
  readonly projectId: string;
  readonly projectIds: readonly string[];
  readonly actorId: string;
  readonly sessionRef: string;
  readonly contentHash: string;
  readonly createdAt: Date;
}

interface RoundRow {
  round_id: string;
  project_id: string;
  project_ids: string[];
  council_id: string;
  command_id: string;
  trigger: PortfolioCouncilDecision["trigger"];
  status: PortfolioCouncilDecision["status"];
  execution_disposition: PortfolioCouncilDecision["executionDisposition"];
  precedence: PortfolioCouncilDecision["precedence"];
  confidence: number | string;
  decision: PortfolioCouncilDecision;
  content_hash: string;
  actor_id: string;
  session_ref: string;
  created_at: Date;
}

function contentHash(decision: PortfolioCouncilDecision): string {
  return createHash("sha256").update(canonicalJson(decision)).digest("hex");
}

function nonblank(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new PortfolioCouncilPersistenceError(`${field} must be a non-empty single-line value`);
  }
}

function assertRecordable(input: RecordPortfolioCouncilDecisionInput): string {
  nonblank(input.projectId, "projectId");
  nonblank(input.actorId, "actorId");
  nonblank(input.sessionRef, "sessionRef");
  const decision = input.decision;
  if (decision.councilId.trim() === "" || decision.commandId.trim() === "") {
    throw new PortfolioCouncilPersistenceError("Portfolio Council identity is required");
  }
  try {
    assertValidPortfolioCouncilDecision(decision);
  } catch (error) {
    throw new PortfolioCouncilPersistenceError(`Portfolio Council decision is invalid: ${error instanceof Error ? error.message : "unknown validation error"}`);
  }
  const goalIds = new Set(decision.goals.map((goal) => goal.goalId));
  const proofs = new Map(input.goalProofs.map((proof) => [proof.goalId, proof]));
  if (proofs.size !== decision.goals.length || [...goalIds].some((goalId) => !proofs.has(goalId))) {
    throw new PortfolioCouncilPersistenceError("Portfolio Council requires one lease proof for every captured Goal");
  }
  for (const proof of proofs.values()) if (!isValidFencingToken(proof.fencingToken)) throw new PortfolioCouncilPersistenceError(`Invalid Goal fencing proof: ${proof.goalId}`);
  if (![...proofs.values()].some((proof) => proof.ownerId === input.actorId)) throw new PortfolioCouncilPersistenceError("Portfolio Council actor is not bound to a captured Goal lease");
  const projectIds = [...new Set(decision.goals.map((goal) => goal.projectId))];
  if (!projectIds.includes(input.projectId)) throw new PortfolioCouncilPersistenceError("Portfolio Council primary project must be one of the captured projects");
  const hash = contentHash(decision);
  if (hash.length !== 64) throw new PortfolioCouncilPersistenceError("Portfolio Council content hash could not be computed");
  return hash;
}

function mapRound(row: RoundRow): PortfolioCouncilDecisionRecord {
  const storedHash = row.content_hash.trim();
  const expectedHash = contentHash(row.decision);
  if (storedHash !== expectedHash) {
    throw new PortfolioCouncilPersistenceError("Stored Portfolio Council content hash does not match its decision");
  }
  return {
    ...row.decision,
    roundId: row.round_id,
    projectId: row.project_id,
    projectIds: [...row.project_ids],
    actorId: row.actor_id,
    sessionRef: row.session_ref,
    contentHash: storedHash,
    createdAt: row.created_at,
  };
}

const ROUND_COLUMNS = `round_id, project_id, project_ids, council_id, command_id, trigger, status,
  execution_disposition, precedence, confidence, decision, content_hash, actor_id,
  session_ref, created_at`;

async function readRound(client: Pool | PoolClient, roundId: string, forUpdate = false): Promise<RoundRow> {
  const result = await client.query<RoundRow>(`SELECT ${ROUND_COLUMNS} FROM portfolio_council_rounds WHERE round_id = $1${forUpdate ? " FOR UPDATE" : ""}`, [roundId]);
  if (result.rowCount !== 1) throw new PortfolioCouncilDecisionNotFoundError(`Portfolio Council round not found: ${roundId}`);
  return result.rows[0]!;
}

function sameReplayIdentity(row: RoundRow, input: RecordPortfolioCouncilDecisionInput, hash: string): boolean {
  return row.project_id === input.projectId
    && row.council_id === input.decision.councilId
    && row.command_id === input.decision.commandId
    && row.content_hash.trim() === hash
    && row.actor_id === input.actorId
    && row.session_ref === input.sessionRef;
}

async function lockPortfolioGoals(client: PoolClient, input: RecordPortfolioCouncilDecisionInput): Promise<void> {
  const proofs = new Map(input.goalProofs.map((proof) => [proof.goalId, proof]));
  for (const goal of [...input.decision.goals].sort((left, right) => left.goalId.localeCompare(right.goalId))) {
    const proof = proofs.get(goal.goalId)!;
    if (proof.goalId !== goal.goalId || proof.ownerId.trim() === "") throw new StaleGoalLeaseError(goal.goalId);
    const lease = await client.query(
      `SELECT 1 FROM goal_leases WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint
       AND expires_at > clock_timestamp() FOR UPDATE`,
      [proof.goalId, proof.ownerId, proof.fencingToken],
    );
    if (lease.rowCount !== 1) throw new StaleGoalLeaseError(goal.goalId);
    const goalRow = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1 FOR KEY SHARE", [goal.goalId]);
    if (goalRow.rowCount !== 1 || goalRow.rows[0]!.project_id !== goal.projectId) throw new PortfolioCouncilPersistenceError(`Portfolio Council Goal/project binding is invalid: ${goal.goalId}`);
    await assertGoalControlOpen(client, goal.goalId);
    const fence = input.decision.actions.find((action) => action.goalId === goal.goalId)?.executionFence;
    if (fence !== undefined) {
      if (fence.previousFencingToken !== proof.fencingToken) throw new PortfolioCouncilPersistenceError(`Execution fence does not match the current Goal lease: ${goal.goalId}`);
      if (!isValidFencingToken(fence.nextFencingToken) || BigInt(fence.nextFencingToken) <= BigInt(fence.previousFencingToken)) throw new PortfolioCouncilPersistenceError(`Execution fence must advance the Goal lease: ${goal.goalId}`);
    }
  }
}

async function assertDurablePortfolioEvidence(client: PoolClient, decision: PortfolioCouncilDecision): Promise<void> {
  const goalIds = decision.goals.map((goal) => goal.goalId);
  const projectIds = [...new Set(decision.goals.map((goal) => goal.projectId))];
  for (const reference of decision.evidenceReferences) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference)) {
      throw new PortfolioCouncilPersistenceError(`Portfolio Council evidence reference is not a durable evidence UUID: ${reference}`);
    }
    const result = await client.query(
      `SELECT 1 FROM evidence_records
       WHERE evidence_id = $1::uuid AND goal_id = ANY($2::uuid[]) AND project_id = ANY($3::uuid[])
       LIMIT 1`,
      [reference, goalIds, projectIds],
    );
    if (result.rowCount !== 1) throw new PortfolioCouncilPersistenceError(`Portfolio Council evidence reference is not bound to a captured Goal: ${reference}`);
  }
}

async function assertDurableDiscordPreemption(client: PoolClient, decision: PortfolioCouncilDecision): Promise<void> {
  const preemption = decision.discordPreemption;
  if (preemption === null) return;
  const result = await client.query<{ linked_goal_id: string | null; severity: string; confidence: number | string }>(
    "SELECT linked_goal_id, severity, confidence FROM discord_incidents WHERE incident_id = $1 FOR KEY SHARE",
    [preemption.incidentId],
  );
  if (result.rowCount !== 1) throw new PortfolioCouncilPersistenceError(`Discord incident is not durable: ${preemption.incidentId}`);
  const incident = result.rows[0]!;
  if (incident.linked_goal_id !== preemption.goalId || incident.severity !== preemption.severity || Number(incident.confidence) < preemption.confidence) {
    throw new PortfolioCouncilPersistenceError(`Discord preemption is not bound to the durable incident: ${preemption.incidentId}`);
  }
  if (requiresImmediateSafePause(preemption.severity, preemption.confidence) && !requiresImmediateSafePause(incident.severity as "info" | "warning" | "critical", Number(incident.confidence))) {
    throw new PortfolioCouncilPersistenceError(`Discord incident does not meet the durable safety threshold: ${preemption.incidentId}`);
  }
}

async function insertFences(client: PoolClient, round: PortfolioCouncilDecisionRecord): Promise<void> {
  for (const action of round.actions) {
    const fence = action.executionFence;
    if (fence === undefined) continue;
    const goal = round.goals.find((candidate) => candidate.goalId === action.goalId);
    if (goal === undefined) throw new PortfolioCouncilPersistenceError(`Execution fence names an uncaptured Goal: ${action.goalId}`);
    await client.query(
      `INSERT INTO portfolio_execution_fences
       (fence_id, round_id, project_id, goal_id, previous_execution_ref,
        previous_fencing_token, next_fencing_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), round.roundId, goal.projectId, action.goalId, fence.previousExecutionRef, fence.previousFencingToken, fence.nextFencingToken],
    );
  }
}

/** Record one immutable, project-bound Portfolio Council decision. */
export async function recordPortfolioCouncilDecision(
  pool: Pool,
  input: RecordPortfolioCouncilDecisionInput,
): Promise<PortfolioCouncilDecisionRecord> {
  const hash = assertRecordable(input);
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await lockPortfolioGoals(client, input);
    await assertDurablePortfolioEvidence(client, input.decision);
    await assertDurableDiscordPreemption(client, input.decision);
    // Serialise retries for a command identity. The identity is text so this
    // also preserves the repository's existing command-id conventions.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.decision.commandId]);
    const existing = await client.query<RoundRow>(`SELECT ${ROUND_COLUMNS} FROM portfolio_council_rounds WHERE command_id = $1 FOR UPDATE`, [input.decision.commandId]);
    if (existing.rowCount === 1) {
      const prior = existing.rows[0]!;
      if (!sameReplayIdentity(prior, input, hash)) {
        throw new PortfolioCouncilPersistenceError("Portfolio Council command identity was reused with different content or binding");
      }
      const mapped = mapRound(prior);
      await client.query("COMMIT");
      open = false;
      return mapped;
    }

    const roundId = randomUUID();
    const inserted = await client.query<RoundRow>(
      `INSERT INTO portfolio_council_rounds
       (round_id, project_id, project_ids, council_id, command_id, trigger, status,
        execution_disposition, precedence, confidence, decision, content_hash,
        actor_id, session_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
       RETURNING ${ROUND_COLUMNS}`,
      [roundId, input.projectId, [...new Set(input.decision.goals.map((goal) => goal.projectId))], input.decision.councilId, input.decision.commandId,
        input.decision.trigger, input.decision.status, input.decision.executionDisposition,
        input.decision.precedence, input.decision.confidence, JSON.stringify(input.decision),
        hash, input.actorId, input.sessionRef],
    );
    const mapped = mapRound(inserted.rows[0]!);
    await insertFences(client, mapped);
    await client.query("COMMIT");
    open = false;
    return mapped;
  } catch (error) {
    if (open) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readPortfolioCouncilDecision(pool: Pool, roundId: string): Promise<PortfolioCouncilDecisionRecord> {
  nonblank(roundId, "roundId");
  return mapRound(await readRound(pool, roundId));
}

export async function listPortfolioCouncilDecisions(pool: Pool, councilId: string): Promise<readonly PortfolioCouncilDecisionRecord[]> {
  nonblank(councilId, "councilId");
  const rows = await pool.query<RoundRow>(`SELECT ${ROUND_COLUMNS} FROM portfolio_council_rounds WHERE council_id = $1 ORDER BY created_at, round_id`, [councilId]);
  return rows.rows.map(mapRound);
}

export interface PortfolioExecutionFenceRecord extends PortfolioExecutionFence {
  readonly fenceId: string;
  readonly roundId: string;
  readonly projectId: string;
  readonly goalId: string;
  readonly createdAt: Date;
}

export async function listPortfolioExecutionFences(pool: Pool, roundId: string): Promise<readonly PortfolioExecutionFenceRecord[]> {
  nonblank(roundId, "roundId");
  const result = await pool.query<{
    fence_id: string; round_id: string; project_id: string; goal_id: string;
    previous_execution_ref: string; previous_fencing_token: string;
    next_fencing_token: string; created_at: Date;
  }>(`SELECT fence_id, round_id, project_id, goal_id, previous_execution_ref,
      previous_fencing_token, next_fencing_token, created_at
    FROM portfolio_execution_fences WHERE round_id = $1 ORDER BY created_at, fence_id`, [roundId]);
  return result.rows.map((row) => ({
    fenceId: row.fence_id, roundId: row.round_id, projectId: row.project_id, goalId: row.goal_id,
    previousExecutionRef: row.previous_execution_ref, previousFencingToken: row.previous_fencing_token,
    nextFencingToken: row.next_fencing_token, createdAt: row.created_at,
  }));
}
