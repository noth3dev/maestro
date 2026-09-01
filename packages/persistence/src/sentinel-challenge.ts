import { randomUUID } from "node:crypto";
import { assertResolverIsNotSentinel, assertValidSentinelChallengeSubstance, SENTINEL_ACTOR_ID, type SentinelChallengeStatus, type SentinelChallengeSubstance } from "@maestro/domain";
import { requestPauseGoal } from "./authority.js";
import type { Pool } from "pg";

export class SentinelChallengeError extends Error {}
export class SentinelChallengeNotFoundError extends SentinelChallengeError {}

export interface SentinelChallenge {
  readonly challengeId: string;
  readonly goalId: string;
  readonly reason: string;
  readonly evidenceReferences: readonly string[];
  readonly status: SentinelChallengeStatus;
  readonly correctionRequest: string | null;
  readonly raisedBy: string;
  readonly resolvedBy: string | null;
  readonly resolutionReason: string | null;
}

interface ChallengeRow {
  challenge_id: string; goal_id: string; reason: string; evidence_references: string[]; status: SentinelChallengeStatus;
  correction_request: string | null; raised_by: string; resolved_by: string | null; resolution_reason: string | null;
}

function mapChallenge(row: ChallengeRow): SentinelChallenge {
  return {
    challengeId: row.challenge_id, goalId: row.goal_id, reason: row.reason, evidenceReferences: row.evidence_references,
    status: row.status, correctionRequest: row.correction_request, raisedBy: row.raised_by,
    resolvedBy: row.resolved_by, resolutionReason: row.resolution_reason,
  };
}

function challengeSelectSql(): string {
  return "SELECT challenge_id, goal_id, reason, evidence_references, status, correction_request, raised_by, resolved_by, resolution_reason FROM sentinel_challenges";
}

/** Sentinel raises a formal challenge, optionally grounded in prior findings, with durable evidence references it must actually resolve to durable records. */
export async function raiseSentinelChallenge(pool: Pool, goalId: string, findingIds: readonly string[], substance: SentinelChallengeSubstance): Promise<SentinelChallenge> {
  assertValidSentinelChallengeSubstance(substance);
  const project = await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId]);
  if (project.rowCount !== 1) throw new SentinelChallengeError("Goal not found for Sentinel challenge");
  const durable = await pool.query<{ evidence_id: string; sha256: string }>("SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2", [goalId, project.rows[0]!.project_id]);
  const durableIds = new Set(durable.rows.flatMap((row) => [row.evidence_id.trim(), row.sha256.trim()]));
  for (const reference of substance.evidenceReferences) if (!durableIds.has(reference.trim())) throw new SentinelChallengeError(`Sentinel challenge evidence reference is not a durable goal-scoped record: ${reference}`);
  if (findingIds.length > 0) {
    const found = await pool.query<{ count: string }>("SELECT count(*)::int AS count FROM sentinel_findings WHERE goal_id = $1 AND finding_id = ANY($2::uuid[])", [goalId, findingIds]);
    if (Number(found.rows[0]!.count) !== findingIds.length) throw new SentinelChallengeError("Sentinel challenge cites a finding that does not exist for this Goal");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const challengeId = randomUUID();
    const inserted = await client.query<ChallengeRow>(
      `INSERT INTO sentinel_challenges (challenge_id, goal_id, reason, evidence_references, status, raised_by)
       VALUES ($1, $2, $3, $4::jsonb, 'open', $5)
       RETURNING challenge_id, goal_id, reason, evidence_references, status, correction_request, raised_by, resolved_by, resolution_reason`,
      [challengeId, goalId, substance.reason, JSON.stringify(substance.evidenceReferences), SENTINEL_ACTOR_ID],
    );
    for (const findingId of findingIds) await client.query("INSERT INTO sentinel_challenge_findings (challenge_id, finding_id) VALUES ($1, $2)", [challengeId, findingId]);
    await client.query("COMMIT");
    return mapChallenge(inserted.rows[0]!);
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function readSentinelChallenge(pool: Pool, challengeId: string): Promise<SentinelChallenge> {
  const result = await pool.query<ChallengeRow>(challengeSelectSql() + " WHERE challenge_id = $1", [challengeId]);
  if (result.rowCount !== 1) throw new SentinelChallengeNotFoundError(`Sentinel challenge not found: ${challengeId}`);
  return mapChallenge(result.rows[0]!);
}

export async function listSentinelChallenges(pool: Pool, goalId: string): Promise<readonly SentinelChallenge[]> {
  const result = await pool.query<ChallengeRow>(challengeSelectSql() + " WHERE goal_id = $1 ORDER BY created_at", [goalId]);
  return result.rows.map(mapChallenge);
}

/** A bounded correction request: a specific, limited fix, not a creative redirection. */
export async function requestSentinelCorrection(pool: Pool, challengeId: string, correctionText: string): Promise<SentinelChallenge> {
  if (correctionText.trim() === "") throw new SentinelChallengeError("A correction request requires nonblank bounded text");
  const current = await readSentinelChallenge(pool, challengeId);
  if (current.status === "resolved") throw new SentinelChallengeError("Cannot request a correction on a resolved challenge");
  const updated = await pool.query<ChallengeRow>(
    "UPDATE sentinel_challenges SET status = 'correction_requested', correction_request = $2 WHERE challenge_id = $1 RETURNING challenge_id, goal_id, reason, evidence_references, status, correction_request, raised_by, resolved_by, resolution_reason",
    [challengeId, correctionText.trim()],
  );
  return mapChallenge(updated.rows[0]!);
}

/** Sentinel requests a real safe pause through the existing Phase 1 authority pause mechanism, then records the link on the challenge. */
export async function requestSentinelSafePause(pool: Pool, challengeId: string, projectId: string): Promise<SentinelChallenge> {
  const current = await readSentinelChallenge(pool, challengeId);
  if (current.status === "resolved") throw new SentinelChallengeError("Cannot request a safe pause on a resolved challenge");
  await requestPauseGoal(pool, projectId, current.goalId);
  const updated = await pool.query<ChallengeRow>(
    "UPDATE sentinel_challenges SET status = 'safe_paused' WHERE challenge_id = $1 RETURNING challenge_id, goal_id, reason, evidence_references, status, correction_request, raised_by, resolved_by, resolution_reason",
    [challengeId],
  );
  return mapChallenge(updated.rows[0]!);
}

/** Resolving a challenge is never permitted for the Sentinel identity itself ("It cannot ... certify its own challenge as resolved"). */
export async function resolveSentinelChallenge(pool: Pool, challengeId: string, resolvedByActorId: string, reason: string): Promise<SentinelChallenge> {
  assertResolverIsNotSentinel(resolvedByActorId);
  if (reason.trim() === "") throw new SentinelChallengeError("A challenge resolution requires a nonblank reason");
  const current = await readSentinelChallenge(pool, challengeId);
  if (current.status === "resolved") return current;
  const updated = await pool.query<ChallengeRow>(
    "UPDATE sentinel_challenges SET status = 'resolved', resolved_by = $2, resolution_reason = $3, resolved_at = transaction_timestamp() WHERE challenge_id = $1 RETURNING challenge_id, goal_id, reason, evidence_references, status, correction_request, raised_by, resolved_by, resolution_reason",
    [challengeId, resolvedByActorId, reason.trim()],
  );
  return mapChallenge(updated.rows[0]!);
}
