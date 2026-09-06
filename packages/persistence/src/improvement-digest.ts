import { randomUUID } from "node:crypto";
import {
  assertSafeImprovementDigestText, normalizeImprovementDigestInput, improvementDigestContentHash, IMPROVEMENT_DIGEST_SCHEMA_VERSION, type ImprovementDigest, type ImprovementDigestInput,
  type ImprovementDigestMetric, type ImprovementDigestSourceRef,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";
import { assertProjectMembership } from "./project-membership.js";

export interface ImprovementDigestAuthor { readonly actorId: string; readonly sessionRef: string; }
export class ImprovementDigestError extends Error {}
export class ImprovementDigestNotFoundError extends ImprovementDigestError {}

interface DigestRow {
  digest_id: string; schema_version: number; project_id: string; goal_id: string; episode_id: string; trigger: ImprovementDigestInput["trigger"];
  situation: string; selected_decision: string; rejected_alternatives: string[]; observed_result: string;
  metrics: ImprovementDigestMetric[]; confidence: number; source_refs: ImprovementDigestSourceRef[]; content_hash: string;
  author_id: string; session_ref: string; created_at: Date;
}
const COLUMNS = "digest_id, schema_version, project_id, goal_id, episode_id, trigger, situation, selected_decision, rejected_alternatives, observed_result, metrics, confidence, source_refs, content_hash, author_id, session_ref, created_at";

function authorValue(value: ImprovementDigestAuthor): void {
  try {
    assertSafeImprovementDigestText(value?.actorId, "author.actorId", 256);
    assertSafeImprovementDigestText(value?.sessionRef, "author.sessionRef", 256);
  } catch (error) {
    throw new ImprovementDigestError(error instanceof Error ? error.message : "Improvement Digest author is invalid");
  }
}
function inputFromRow(row: DigestRow): ImprovementDigestInput {
  return {
    schemaVersion: IMPROVEMENT_DIGEST_SCHEMA_VERSION, projectId: row.project_id, goalId: row.goal_id, episodeId: row.episode_id, trigger: row.trigger, situation: row.situation,
    selectedDecision: row.selected_decision, rejectedAlternatives: row.rejected_alternatives, observedResult: row.observed_result,
    metrics: row.metrics, confidence: Number(row.confidence), sourceRefs: row.source_refs,
  };
}
function map(row: DigestRow): ImprovementDigest {
  if (row.schema_version !== IMPROVEMENT_DIGEST_SCHEMA_VERSION) throw new ImprovementDigestError("Improvement Digest schema version is unsupported");
  const input = inputFromRow(row); const actualHash = improvementDigestContentHash(input);
  if (actualHash !== row.content_hash.trim()) throw new ImprovementDigestError("Improvement Digest content hash is invalid");
  return { ...input, digestId: row.digest_id, contentHash: row.content_hash.trim(), authorId: row.author_id, sessionRef: row.session_ref, createdAt: row.created_at.toISOString() };
}

async function assertSourceRefs(client: PoolClient, input: ImprovementDigestInput): Promise<void> {
  for (const source of input.sourceRefs) {
    let result: { project_id?: string; goal_id?: string } | undefined;
    if (source.kind === "goal") {
      const row = await client.query<{ project_id: string; goal_id: string }>("SELECT project_id, goal_id FROM goals WHERE goal_id = $1", [source.sourceId]); result = row.rows[0];
    } else if (source.kind === "evidence_record") {
      const row = await client.query<{ project_id: string; goal_id: string }>("SELECT project_id, goal_id FROM evidence_records WHERE evidence_id = $1", [source.sourceId]); result = row.rows[0];
    } else if (source.kind === "evidence_bundle") {
      const row = await client.query<{ project_id: string; goal_id: string }>("SELECT g.project_id, b.goal_id FROM evidence_bundles b JOIN goals g ON g.goal_id = b.goal_id WHERE b.bundle_id = $1", [source.sourceId]); result = row.rows[0];
    } else if (source.kind === "metronome_finding") {
      const row = await client.query<{ project_id: string; goal_id: string }>("SELECT g.project_id, f.goal_id FROM metronome_findings f JOIN goals g ON g.goal_id = f.goal_id WHERE f.finding_id = $1", [source.sourceId]); result = row.rows[0];
    } else if (source.kind === "encore_round") {
      const row = await client.query<{ project_id: string; goal_id: string }>("SELECT g.project_id, r.goal_id FROM encore_council_rounds r JOIN goals g ON g.goal_id = r.goal_id WHERE r.round_id = $1", [source.sourceId]); result = row.rows[0];
    } else {
      const row = await client.query<{ project_id: string; goal_id: string }>(
        `SELECT g.project_id, i.linked_goal_id AS goal_id
           FROM discord_improvement_evidence e
           JOIN discord_incidents i ON i.incident_id = e.incident_id
           JOIN goals g ON g.goal_id = i.linked_goal_id
          WHERE e.evidence_id = $1 AND i.status IN ('resolved', 'false_positive')`, [source.sourceId],
      ); result = row.rows[0];
    }
    if (result === undefined || result.goal_id !== input.goalId || result.project_id !== input.projectId) throw new ImprovementDigestError(`Improvement Digest source is missing or outside the Goal project: ${source.kind}:${source.sourceId}`);
  }
}

/** Record one immutable, project-private digest while the Goal authority is held. */
export async function recordImprovementDigest(pool: Pool, input: ImprovementDigestInput, proof: GoalLeaseProof, author: ImprovementDigestAuthor): Promise<ImprovementDigest> {
  const normalizedInput = normalizeImprovementDigestInput(input); authorValue(author);
  if (proof.goalId !== normalizedInput.goalId) throw new ImprovementDigestError("Improvement Digest Goal identity mismatch");
  const contentHash = improvementDigestContentHash(normalizedInput);
  return withGoalAuthority(pool, proof, 63, async (client) => {
    const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [normalizedInput.goalId]);
    if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== normalizedInput.projectId) throw new ImprovementDigestError("Improvement Digest project does not match its Goal");
    await assertSourceRefs(client, normalizedInput);
    const prior = await client.query<DigestRow>(`SELECT ${COLUMNS} FROM improvement_digests WHERE project_id = $1 AND goal_id = $2 AND episode_id = $3`, [normalizedInput.projectId, normalizedInput.goalId, normalizedInput.episodeId]);
    if (prior.rowCount !== 0) {
      const existing = map(prior.rows[0]!);
      if (existing.contentHash !== contentHash) throw new ImprovementDigestError("Improvement Digest content conflict for episode");
      return existing;
    }
    const inserted = await client.query<DigestRow>(
      `INSERT INTO improvement_digests (digest_id, schema_version, project_id, goal_id, episode_id, trigger, situation, selected_decision, rejected_alternatives, observed_result, metrics, confidence, source_refs, content_hash, author_id, session_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13::jsonb, $14, $15, $16) RETURNING ${COLUMNS}`,
      [randomUUID(), normalizedInput.schemaVersion, normalizedInput.projectId, normalizedInput.goalId, normalizedInput.episodeId, normalizedInput.trigger, normalizedInput.situation, normalizedInput.selectedDecision, JSON.stringify(normalizedInput.rejectedAlternatives), normalizedInput.observedResult, JSON.stringify(normalizedInput.metrics), normalizedInput.confidence, JSON.stringify(normalizedInput.sourceRefs), contentHash, author.actorId.trim(), author.sessionRef.trim()],
    );
    return map(inserted.rows[0]!);
  });
}
export interface ImprovementDigestReadAuthorization { readonly operatorId: string; readonly projectId: string; }

function readAuthorization(value: ImprovementDigestReadAuthorization): void {
  if (!value || typeof value.operatorId !== "string" || value.operatorId.trim() === "" || typeof value.projectId !== "string" || value.projectId.trim() === "") throw new ImprovementDigestError("Improvement Digest read authorization is required");
}

async function withDigestReadAuthorization<T>(pool: Pool, authorization: ImprovementDigestReadAuthorization, read: (client: PoolClient) => Promise<T>): Promise<T> {
  readAuthorization(authorization);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertProjectMembership(client, authorization.operatorId, authorization.projectId);
    const result = await read(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listImprovementDigests(pool: Pool, authorization: ImprovementDigestReadAuthorization, goalId?: string): Promise<readonly ImprovementDigest[]> {
  return withDigestReadAuthorization(pool, authorization, async (client) => {
    const result = await client.query<DigestRow>(`SELECT ${COLUMNS} FROM improvement_digests WHERE project_id = $1 AND ($2::uuid IS NULL OR goal_id = $2) ORDER BY created_at, digest_id`, [authorization.projectId, goalId ?? null]);
    return result.rows.map(map);
  });
}

export async function readImprovementDigest(pool: Pool, authorization: ImprovementDigestReadAuthorization, digestId: string): Promise<ImprovementDigest> {
  return withDigestReadAuthorization(pool, authorization, async (client) => {
    const result = await client.query<DigestRow>(`SELECT ${COLUMNS} FROM improvement_digests WHERE digest_id = $1 AND project_id = $2`, [digestId.trim(), authorization.projectId]);
    if (result.rowCount !== 1) throw new ImprovementDigestNotFoundError(`Improvement Digest not found: ${digestId}`);
    return map(result.rows[0]!);
  });
}
