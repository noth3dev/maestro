import { createHash, randomUUID } from "node:crypto";
import type {
  PortfolioCouncilDecision,
  PortfolioExecutionFence,
} from "@maestro/domain";
import { canonicalJson } from "@maestro/domain";
import type { Pool, PoolClient } from "pg";

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
}

export interface PortfolioCouncilDecisionRecord extends PortfolioCouncilDecision {
  readonly roundId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly sessionRef: string;
  readonly contentHash: string;
  readonly createdAt: Date;
}

interface RoundRow {
  round_id: string;
  project_id: string;
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
    actorId: row.actor_id,
    sessionRef: row.session_ref,
    contentHash: storedHash,
    createdAt: row.created_at,
  };
}

const ROUND_COLUMNS = `round_id, project_id, council_id, command_id, trigger, status,
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

async function insertFences(client: PoolClient, round: PortfolioCouncilDecisionRecord): Promise<void> {
  for (const action of round.actions) {
    const fence = action.executionFence;
    if (fence === undefined) continue;
    await client.query(
      `INSERT INTO portfolio_execution_fences
       (fence_id, round_id, project_id, goal_id, previous_execution_ref,
        previous_fencing_token, next_fencing_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), round.roundId, round.projectId, action.goalId, fence.previousExecutionRef, fence.previousFencingToken, fence.nextFencingToken],
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
       (round_id, project_id, council_id, command_id, trigger, status,
        execution_disposition, precedence, confidence, decision, content_hash,
        actor_id, session_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
       RETURNING ${ROUND_COLUMNS}`,
      [roundId, input.projectId, input.decision.councilId, input.decision.commandId,
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
