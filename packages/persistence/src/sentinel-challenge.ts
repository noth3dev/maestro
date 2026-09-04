import { createHash, randomUUID } from "node:crypto";
import {
  assertResolverIsNotSentinel,
  assertValidSentinelChallengeSubstance,
  canonicalJson,
  isSentinelRoleIdentity,
  normalizeSentinelIdentity,
  SENTINEL_ACTOR_ID,
  type SentinelChallengeStatus,
  type SentinelChallengeSubstance,
} from "@maestro/domain";
import { requestPauseGoalInTransaction } from "./authority.js";
import { StaleGoalLeaseError, isValidFencingToken, type GoalLeaseProof } from "./commands.js";
import type { CouncilActorContext } from "./council.js";
import type { Pool, PoolClient } from "pg";

export class SentinelChallengeError extends Error {}
export class SentinelChallengeNotFoundError extends SentinelChallengeError {}
export class SentinelAuthorizationError extends SentinelChallengeError {}

/** Identity/session proof supplied by the active control-plane caller. */
export type SentinelActorContext = CouncilActorContext;

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
  idempotency_key?: string | null; request_hash?: string | null;
}

interface FindingIdentityRow {
  finding_id: string;
  rule_id: string;
  evidence_identity: string;
  plan_version: number;
}

function mapChallenge(row: ChallengeRow): SentinelChallenge {
  return {
    challengeId: normalizeSentinelIdentity(row.challenge_id), goalId: normalizeSentinelIdentity(row.goal_id),
    reason: row.reason, evidenceReferences: row.evidence_references.map(normalizeSentinelIdentity),
    status: row.status, correctionRequest: row.correction_request, raisedBy: normalizeSentinelIdentity(row.raised_by),
    resolvedBy: row.resolved_by === null ? null : normalizeSentinelIdentity(row.resolved_by),
    resolutionReason: row.resolution_reason,
  };
}

const CHALLENGE_COLUMNS = "challenge_id, goal_id, reason, evidence_references, status, correction_request, raised_by, resolved_by, resolution_reason";

function challengeSelectSql(): string {
  return `SELECT ${CHALLENGE_COLUMNS} FROM sentinel_challenges`;
}

function challengeSelectWithIdentitySql(): string {
  return `SELECT ${CHALLENGE_COLUMNS}, idempotency_key, request_hash FROM sentinel_challenges`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function findingIdentity(goalId: string, rows: readonly FindingIdentityRow[], evidenceReferences: readonly string[]): Readonly<Record<string, unknown>> {
  const findings = rows.map((row) => ({
    ruleId: normalizeSentinelIdentity(row.rule_id), evidenceIdentity: normalizeSentinelIdentity(row.evidence_identity),
    planVersion: row.plan_version,
  })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  return {
    goalId: normalizeSentinelIdentity(goalId),
    findings,
    evidenceReferences: [...new Set(evidenceReferences.map(normalizeSentinelIdentity))].sort(),
  };
}

function assertContext(context: SentinelActorContext | undefined): SentinelActorContext {
  if (!context || typeof context.actorId !== "string" || typeof context.sessionRef !== "string"
      || normalizeSentinelIdentity(context.actorId) === "" || normalizeSentinelIdentity(context.sessionRef) === "") {
    throw new SentinelAuthorizationError("Sentinel mutation requires a nonblank actor and session context");
  }
  return context;
}

export function requireSentinelAuthorization(
  proof: GoalLeaseProof | undefined,
  context: SentinelActorContext | undefined,
): { proof: GoalLeaseProof; context: SentinelActorContext } {
  if (proof === undefined || context === undefined) {
    throw new SentinelAuthorizationError("Sentinel mutation requires a current lease proof and actor session context");
  }
  return { proof, context: assertContext(context) };
}

function assertProof(goalId: string, proof: GoalLeaseProof | undefined): GoalLeaseProof {
  if (!proof || typeof proof.goalId !== "string" || typeof proof.ownerId !== "string" || typeof proof.fencingToken !== "string"
      || normalizeSentinelIdentity(proof.goalId) !== normalizeSentinelIdentity(goalId)
      || normalizeSentinelIdentity(proof.ownerId) === "" || !isValidFencingToken(proof.fencingToken)) {
    throw new StaleGoalLeaseError(normalizeSentinelIdentity(goalId));
  }
  return proof;
}

async function lockGoalLease(client: PoolClient, goalId: string, proof: GoalLeaseProof | undefined): Promise<void> {
  const checked = assertProof(goalId, proof);
  const lease = await client.query(
    `SELECT 1 FROM goal_leases
      WHERE goal_id = $1 AND owner_id = $2 AND fencing_token = $3::bigint
        AND expires_at > clock_timestamp()
      FOR UPDATE`,
    [normalizeSentinelIdentity(goalId), normalizeSentinelIdentity(checked.ownerId), checked.fencingToken],
  );
  if (lease.rowCount !== 1) throw new StaleGoalLeaseError(normalizeSentinelIdentity(goalId));
}

/**
 * Authorizes a Sentinel mutation against durable Goal lease and organization
 * state. Sentinel is a permanent organization-wide role, not a Department
 * Head participation; resolver actors may be captured active Heads or the
 * canonical non-Sentinel system roles.
 */
export async function assertSentinelMutationAuthorized(
  client: PoolClient,
  goalId: string,
  proof: GoalLeaseProof | undefined,
  context: SentinelActorContext | undefined,
  kind: "sentinel" | "resolver",
  raisedBy?: string,
): Promise<void> {
  const normalizedGoalId = normalizeSentinelIdentity(goalId);
  const actorContext = assertContext(context);
  const actorId = normalizeSentinelIdentity(actorContext.actorId);
  const sessionRef = normalizeSentinelIdentity(actorContext.sessionRef);
  await lockGoalLease(client, normalizedGoalId, proof);

  if (kind === "sentinel") {
    const role = await client.query(
      `SELECT 1 FROM permanent_roles
        WHERE btrim(role_id) = $1 AND role_kind = 'sentinel'
        FOR KEY SHARE`,
      [actorId],
    );
    if (role.rowCount !== 1 || !isSentinelRoleIdentity(actorId)) {
      throw new SentinelAuthorizationError("Actor is not the canonical permanent Sentinel role");
    }
    return;
  }

  // The durable raised_by value is consulted before authorization so a
  // canonical Sentinel cannot resolve its own challenge even with a forged
  // caller context.
  assertResolverIsNotSentinel(actorId, raisedBy);
  const activeHead = await client.query(
    `SELECT 1 FROM goal_head_participations
      WHERE goal_id = $1 AND status = 'active'
        AND btrim(head_role_id) = $2 AND btrim(active_session_ref) = $3
      FOR KEY SHARE`,
    [normalizedGoalId, actorId, sessionRef],
  );
  if (activeHead.rowCount === 1) return;

  // Sane and Encore Council are permanent organization identities rather
  // than Department participations. They remain valid non-Sentinel resolvers,
  // but still require the Goal lease and a nonblank session proof.
  const systemRole = await client.query(
    `SELECT 1 FROM permanent_roles
      WHERE btrim(role_id) = $1 AND role_kind IN ('sane', 'encore_council')
      FOR KEY SHARE`,
    [actorId],
  );
  if (systemRole.rowCount !== 1) {
    throw new SentinelAuthorizationError("Resolver is not a captured active Head or canonical non-Sentinel role");
  }
}

async function loadGoalProject(client: PoolClient, goalId: string): Promise<string> {
  const result = await client.query<{ project_id: string }>(
    "SELECT project_id FROM goals WHERE goal_id = $1 FOR KEY SHARE",
    [normalizeSentinelIdentity(goalId)],
  );
  if (result.rowCount !== 1) throw new SentinelChallengeError("Goal not found for Sentinel challenge");
  return normalizeSentinelIdentity(result.rows[0]!.project_id);
}

async function loadChallenge(client: PoolClient, challengeId: string, forUpdate = false): Promise<ChallengeRow> {
  const lock = forUpdate ? " FOR UPDATE" : "";
  const result = await client.query<ChallengeRow>(challengeSelectSql() + ` WHERE challenge_id = $1${lock}`, [normalizeSentinelIdentity(challengeId)]);
  if (result.rowCount !== 1) throw new SentinelChallengeNotFoundError(`Sentinel challenge not found: ${challengeId}`);
  return result.rows[0]!;
}

/** Sentinel raises a formal challenge, optionally grounded in prior findings, with durable evidence references it must actually resolve to durable records. */
export async function raiseSentinelChallenge(
  pool: Pool,
  goalId: string,
  findingIds: readonly string[],
  substance: SentinelChallengeSubstance,
  proof: GoalLeaseProof,
  context: SentinelActorContext,
): Promise<SentinelChallenge> {
  assertValidSentinelChallengeSubstance(substance);
  const authorization = requireSentinelAuthorization(proof, context);
  const normalizedGoalId = normalizeSentinelIdentity(goalId);
  const normalizedFindingIds = findingIds.map(normalizeSentinelIdentity);
  if (new Set(normalizedFindingIds).size !== normalizedFindingIds.length) throw new SentinelChallengeError("Sentinel challenge finding identities must be unique");
  const normalizedEvidenceReferences = substance.evidenceReferences.map(normalizeSentinelIdentity);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    await assertSentinelMutationAuthorized(client, normalizedGoalId, authorization.proof, authorization.context, "sentinel");
    const projectId = await loadGoalProject(client, normalizedGoalId);
    const durable = await client.query<{ evidence_id: string; sha256: string }>(
      "SELECT evidence_id, sha256 FROM evidence_records WHERE goal_id = $1 AND project_id = $2",
      [normalizedGoalId, projectId],
    );
    const durableIds = new Set(durable.rows.flatMap((row) => [normalizeSentinelIdentity(row.evidence_id), normalizeSentinelIdentity(row.sha256)]));
    for (const reference of normalizedEvidenceReferences) if (!durableIds.has(reference)) throw new SentinelChallengeError(`Sentinel challenge evidence reference is not a durable goal-scoped record: ${reference}`);

    const found = normalizedFindingIds.length === 0
      ? { rows: [] as FindingIdentityRow[], rowCount: 0 }
      : await client.query<FindingIdentityRow>(
        `SELECT finding_id, rule_id, evidence_identity, plan_version
           FROM sentinel_findings
          WHERE goal_id = $1 AND finding_id = ANY($2::uuid[])
          ORDER BY finding_id
          FOR KEY SHARE`,
        [normalizedGoalId, normalizedFindingIds],
      );
    if (found.rowCount !== normalizedFindingIds.length) throw new SentinelChallengeError("Sentinel challenge cites a finding that does not exist for this Goal");
    const identity = findingIdentity(normalizedGoalId, found.rows, normalizedEvidenceReferences);
    const idempotencyKey = hash(identity);
    const requestHash = hash({ identity, findingIds: [...normalizedFindingIds].sort(), reason: substance.reason.trim() });
    const inserted = await client.query<ChallengeRow>(
      `INSERT INTO sentinel_challenges
         (challenge_id, goal_id, reason, evidence_references, status, raised_by, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4::jsonb, 'open', $5, $6, $7)
       ON CONFLICT (goal_id, idempotency_key) DO NOTHING
       RETURNING ${CHALLENGE_COLUMNS}, idempotency_key, request_hash`,
      [randomUUID(), normalizedGoalId, substance.reason.trim(), JSON.stringify(normalizedEvidenceReferences), SENTINEL_ACTOR_ID, idempotencyKey, requestHash],
    );
    if (inserted.rowCount === 1) {
      for (const findingId of normalizedFindingIds) {
        await client.query("INSERT INTO sentinel_challenge_findings (challenge_id, finding_id) VALUES ($1, $2)", [inserted.rows[0]!.challenge_id, findingId]);
      }
      await client.query("COMMIT"); open = false;
      return mapChallenge(inserted.rows[0]!);
    }
    const existing = await client.query<ChallengeRow>(
      challengeSelectWithIdentitySql() + " WHERE goal_id = $1 AND idempotency_key = $2 FOR UPDATE",
      [normalizedGoalId, idempotencyKey],
    );
    if (existing.rowCount !== 1) throw new SentinelChallengeError("Sentinel challenge idempotency conflict did not resolve to a durable row");
    const prior = existing.rows[0]!;
    if (prior.request_hash !== null && prior.request_hash !== undefined && prior.request_hash.trim() !== requestHash) {
      throw new SentinelChallengeError("Sentinel challenge idempotency identity was reused with different content");
    }
    await client.query("COMMIT"); open = false;
    return mapChallenge(prior);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function readSentinelChallenge(pool: Pool, challengeId: string): Promise<SentinelChallenge> {
  const result = await pool.query<ChallengeRow>(challengeSelectSql() + " WHERE challenge_id = $1", [normalizeSentinelIdentity(challengeId)]);
  if (result.rowCount !== 1) throw new SentinelChallengeNotFoundError(`Sentinel challenge not found: ${challengeId}`);
  return mapChallenge(result.rows[0]!);
}

export async function listSentinelChallenges(pool: Pool, goalId: string): Promise<readonly SentinelChallenge[]> {
  const result = await pool.query<ChallengeRow>(challengeSelectSql() + " WHERE goal_id = $1 ORDER BY created_at", [normalizeSentinelIdentity(goalId)]);
  return result.rows.map(mapChallenge);
}

/** A bounded correction request: a specific, limited fix, not a creative redirection. */
export async function requestSentinelCorrection(
  pool: Pool,
  challengeId: string,
  correctionText: string,
  proof: GoalLeaseProof,
  context: SentinelActorContext,
): Promise<SentinelChallenge> {
  if (correctionText.trim() === "") throw new SentinelChallengeError("A correction request requires nonblank bounded text");
  const authorization = requireSentinelAuthorization(proof, context);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const candidate = await loadChallenge(client, challengeId);
    await assertSentinelMutationAuthorized(client, candidate.goal_id, authorization.proof, authorization.context, "sentinel");
    const current = await loadChallenge(client, challengeId, true);
    if (current.status === "resolved") throw new SentinelChallengeError("Cannot request a correction on a resolved challenge");
    const updated = await client.query<ChallengeRow>(
      `UPDATE sentinel_challenges SET status = 'correction_requested', correction_request = $2
        WHERE challenge_id = $1 RETURNING ${CHALLENGE_COLUMNS}`,
      [normalizeSentinelIdentity(challengeId), correctionText.trim()],
    );
    await client.query("COMMIT"); open = false;
    return mapChallenge(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Sentinel requests a real safe pause through the Phase 1 authority mechanism, then records the link on the challenge. */
export async function requestSentinelSafePause(
  pool: Pool,
  challengeId: string,
  projectId: string,
  proof: GoalLeaseProof,
  context: SentinelActorContext,
): Promise<SentinelChallenge> {
  const normalizedProjectId = normalizeSentinelIdentity(projectId);
  const authorization = requireSentinelAuthorization(proof, context);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const candidate = await loadChallenge(client, challengeId);
    await assertSentinelMutationAuthorized(client, candidate.goal_id, authorization.proof, authorization.context, "sentinel");
    const current = await loadChallenge(client, challengeId, true);
    if (current.status === "resolved") throw new SentinelChallengeError("Cannot request a safe pause on a resolved challenge");
    const boundProjectId = await loadGoalProject(client, current.goal_id);
    if (normalizedProjectId === "" || boundProjectId !== normalizedProjectId) throw new SentinelChallengeError("Supplied projectId is not bound to the challenge Goal");
    await requestPauseGoalInTransaction(client, normalizedProjectId, normalizeSentinelIdentity(current.goal_id));
    const updated = await client.query<ChallengeRow>(
      `UPDATE sentinel_challenges SET status = 'safe_paused'
        WHERE challenge_id = $1 RETURNING ${CHALLENGE_COLUMNS}`,
      [normalizeSentinelIdentity(challengeId)],
    );
    await client.query("COMMIT"); open = false;
    return mapChallenge(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Resolving a challenge is never permitted for the canonical Sentinel identity itself. */
export async function resolveSentinelChallenge(
  pool: Pool,
  challengeId: string,
  resolvedByActorId: string,
  reason: string,
  proof: GoalLeaseProof,
  context: SentinelActorContext,
): Promise<SentinelChallenge> {
  if (reason.trim() === "") throw new SentinelChallengeError("A challenge resolution requires a nonblank reason");
  const authorization = requireSentinelAuthorization(proof, context);
  const client = await pool.connect(); let open = false;
  try {
    await client.query("BEGIN"); open = true;
    const candidate = await loadChallenge(client, challengeId);
    const actorId = normalizeSentinelIdentity(resolvedByActorId);
    const actorContext = authorization.context;
    if (normalizeSentinelIdentity(actorContext.actorId) !== actorId) throw new SentinelAuthorizationError("Resolved actor does not match the supplied session context");
    await assertSentinelMutationAuthorized(client, candidate.goal_id, authorization.proof, actorContext, "resolver", candidate.raised_by);
    const current = await loadChallenge(client, challengeId, true);
    if (current.status === "resolved") {
      await client.query("COMMIT"); open = false;
      return mapChallenge(current);
    }
    const updated = await client.query<ChallengeRow>(
      `UPDATE sentinel_challenges
          SET status = 'resolved', resolved_by = $2, resolution_reason = $3, resolved_at = transaction_timestamp()
        WHERE challenge_id = $1 RETURNING ${CHALLENGE_COLUMNS}`,
      [normalizeSentinelIdentity(challengeId), actorId, reason.trim()],
    );
    await client.query("COMMIT"); open = false;
    return mapChallenge(updated.rows[0]!);
  } catch (error) { if (open) await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
