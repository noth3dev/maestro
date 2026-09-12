import {
  assertValidOrganizationalKnowledgeProposal, createWorkerProposedKnowledge, decayOrganizationalKnowledge as decayKnowledge, promoteKnowledgeToGlobal, promoteKnowledgeToProject,
  retireOrganizationalKnowledge as retireKnowledge, type GlobalKnowledgePromotion, type OrganizationalKnowledge,
  type OrganizationalKnowledgeProposal, type OrganizationalKnowledgeStatus,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";
import { assertProjectMembership } from "./project-membership.js";

export type OrganizationalKnowledgeProposalRecord = OrganizationalKnowledgeProposal;
export interface OrganizationalKnowledgeAuthor { readonly actorId: string; readonly sessionRef: string; }
export interface OrganizationalKnowledgeReadAuthorization { readonly operatorId: string; readonly projectId: string; readonly departmentId: string; }
export class OrganizationalKnowledgeError extends Error {}
export class OrganizationalKnowledgeNotFoundError extends OrganizationalKnowledgeError {}
export interface OrganizationalKnowledgePublic {
  readonly knowledgeId: string; readonly revision: number; readonly departmentId: string; readonly scope: "global";
  readonly status: OrganizationalKnowledgeStatus; readonly statement: string; readonly rationale: string;
  readonly confidence: number; readonly freshness: number; readonly generalized: true; readonly createdAt: string;
}

interface KnowledgeRow {
  knowledge_id: string; revision: number; schema_version: number; source_project_id: string; project_id: string | null; source_goal_id: string;
  department_id: string; scope: OrganizationalKnowledge["scope"]; status: OrganizationalKnowledgeStatus; statement: string; rationale: string;
  source_evidence_ids: string[]; source_digest_ids: string[]; episode_ids: string[]; confidence: number; freshness: number; generalized: boolean;
  council_round_id: string | null; generalized_statement: string | null; curator_role_id: string | null; promotion_marker: string; reason: string | null; created_by: string; source_session_ref: string; created_at: Date;
}
const COLUMNS = "knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, generalized_statement, curator_role_id, promotion_marker, reason, created_by, source_session_ref, created_at";
const INSERT_COLUMNS = COLUMNS.replace(", created_at", "");

function marker(lesson: OrganizationalKnowledge): string {
  if (lesson.scope === "worker_proposed") return "worker-proposal";
  if (lesson.status === "active" && lesson.scope === "project_department") return "department-promotion";
  if (lesson.status === "active" && lesson.scope === "global") return "global-promotion";
  if (lesson.status === "unsupported") return lesson.sourceSessionRef?.startsWith("evidence:") || lesson.sourceSessionRef?.startsWith("digest:") ? "source-loss" : "knowledge-decay";
  if (lesson.status === "contradicted") return "knowledge-decay";
  return "adjudication";
}
function map(row: KnowledgeRow): OrganizationalKnowledge {
  const value: OrganizationalKnowledge = {
    schemaVersion: 1, knowledgeId: row.knowledge_id, revision: row.revision, sourceProjectId: row.source_project_id,
    projectId: row.project_id, sourceGoalId: row.source_goal_id, departmentId: row.department_id, scope: row.scope, status: row.status,
    statement: row.statement, rationale: row.rationale, sourceEvidenceIds: row.source_evidence_ids, sourceDigestIds: row.source_digest_ids,
    episodeIds: row.episode_ids, confidence: Number(row.confidence), freshness: Number(row.freshness), generalized: row.generalized,
    councilRoundId: row.council_round_id, reason: row.reason,
    ...(row.generalized_statement === null ? {} : { generalizedStatement: row.generalized_statement }),
    ...(row.curator_role_id === null ? {} : { curatorRoleId: row.curator_role_id }),
    createdAt: row.created_at.toISOString(), createdBy: row.created_by, sourceSessionRef: row.source_session_ref,
  };
  return Object.freeze({ ...value, sourceEvidenceIds: Object.freeze([...value.sourceEvidenceIds]), sourceDigestIds: Object.freeze([...value.sourceDigestIds]), episodeIds: Object.freeze([...value.episodeIds]) });
}
function publicProjection(lesson: OrganizationalKnowledge): OrganizationalKnowledgePublic {
  if (lesson.scope !== "global" || lesson.generalized !== true || lesson.generalizedStatement === undefined) throw new OrganizationalKnowledgeError("global knowledge is not safe to publish");
  return Object.freeze({ knowledgeId: lesson.knowledgeId, revision: lesson.revision, departmentId: lesson.departmentId, scope: "global", status: lesson.status, statement: lesson.generalizedStatement, rationale: "Generalized organizational guidance.", confidence: lesson.confidence, freshness: lesson.freshness, generalized: true, createdAt: lesson.createdAt });
}

function authorValue(author: OrganizationalKnowledgeAuthor): void {
  if (!author || typeof author.actorId !== "string" || author.actorId.trim() === "" || author.actorId.length > 256 || typeof author.sessionRef !== "string" || author.sessionRef.trim() === "" || author.sessionRef.length > 256) throw new OrganizationalKnowledgeError("organizational knowledge author is invalid");
}
async function insertRevision(client: Pick<PoolClient, "query">, lesson: OrganizationalKnowledge, createdBy: string, sourceSessionRef: string): Promise<OrganizationalKnowledge> {
  const result = await client.query<KnowledgeRow>(
    `INSERT INTO organizational_knowledge (${INSERT_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING ${COLUMNS}`,
    [lesson.knowledgeId, lesson.revision, lesson.schemaVersion, lesson.sourceProjectId, lesson.projectId, lesson.sourceGoalId, lesson.departmentId, lesson.scope, lesson.status, lesson.statement, lesson.rationale, JSON.stringify(lesson.sourceEvidenceIds), JSON.stringify(lesson.sourceDigestIds), JSON.stringify(lesson.episodeIds), lesson.confidence, lesson.freshness, lesson.generalized, lesson.councilRoundId, lesson.generalizedStatement ?? null, lesson.curatorRoleId ?? null, marker(lesson), lesson.reason, createdBy, sourceSessionRef],
  );
  return map(result.rows[0]!);
}

/** Stores worker evidence as a proposal. This operation cannot create an active organizational lesson. */
export async function proposeOrganizationalKnowledge(pool: Pool, input: OrganizationalKnowledgeProposal, proof: GoalLeaseProof, author: OrganizationalKnowledgeAuthor): Promise<OrganizationalKnowledge> {
  assertValidOrganizationalKnowledgeProposal(input); authorValue(author);
  if (proof.goalId !== input.sourceGoalId) throw new OrganizationalKnowledgeError("knowledge source Goal does not match lease proof");
  const proposal = createWorkerProposedKnowledge(input);
  return withGoalAuthority(pool, proof, 63, async (client) => insertRevision(client, proposal, author.actorId.trim(), author.sessionRef.trim()));
}

async function withKnowledgeTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
async function readCurrent(client: Pick<PoolClient, "query">, knowledgeId: string, lock = false): Promise<OrganizationalKnowledge> {
  const result = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge WHERE knowledge_id = $1 ORDER BY revision DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`, [knowledgeId.trim()]);
  if (result.rowCount !== 1) throw new OrganizationalKnowledgeNotFoundError(`organizational knowledge not found: ${knowledgeId}`);
  return map(result.rows[0]!);
}
async function assertHead(client: Pick<PoolClient, "query">, roleId: string, departmentId: string): Promise<void> {
  const result = await client.query<{ role_kind: string; department_id: string | null; status: string }>("SELECT role_kind, department_id, status FROM permanent_roles WHERE role_id = $1", [roleId.trim()]);
  const role = result.rows[0];
  if (role === undefined || role.role_kind !== "department_head" || role.department_id !== departmentId || role.status !== "standing") throw new OrganizationalKnowledgeError("Department Head identity or department is invalid");
}

export async function promoteOrganizationalKnowledgeToProject(pool: Pool, request: { readonly knowledgeId: string; readonly promoterRoleId: string; readonly departmentId: string }): Promise<OrganizationalKnowledge> {
  return withKnowledgeTransaction(pool, async (client) => {
    await assertHead(client, request.promoterRoleId, request.departmentId);
    const current = await readCurrent(client, request.knowledgeId, true);
    const promoted = promoteKnowledgeToProject(current, { promoterRoleKind: "department_head", promoterDepartmentId: request.departmentId });
    return insertRevision(client, promoted, request.promoterRoleId, `promotion:${request.promoterRoleId}`);
  });
}

export async function promoteOrganizationalKnowledgeToGlobal(pool: Pool, request: { readonly knowledgeId: string; readonly promoterRoleId: string; readonly departmentId: string; readonly encoreCouncilRoundId: string; readonly corroboratingSourceIds: readonly string[]; readonly corroboratingEpisodeIds: readonly string[]; readonly generalizedStatement: string; readonly curatorRoleId: string }): Promise<OrganizationalKnowledgePublic> {
  return withKnowledgeTransaction(pool, async (client) => {
    await assertHead(client, request.promoterRoleId, request.departmentId);
    const current = await readCurrent(client, request.knowledgeId, true);
    await assertHead(client, request.curatorRoleId, request.departmentId);
    if (request.curatorRoleId === request.promoterRoleId) throw new OrganizationalKnowledgeError("global generalization requires an independent Department Head curator");
    const approval = await client.query<{ final_verdict: string }>(
      `SELECT s.final_verdict FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id
        WHERE r.round_id = $1 AND r.goal_id = $2 AND s.final_verdict = 'proceed' AND s.same_model_only = false
          AND r.evidence_ids @> $3::jsonb`,
      [request.encoreCouncilRoundId, current.sourceGoalId, JSON.stringify([...current.sourceEvidenceIds, ...current.sourceDigestIds])],
    );
    const sourceIds = request.corroboratingSourceIds ?? [];
    for (const sourceId of sourceIds) {
      if (current.sourceEvidenceIds.includes(sourceId.toLowerCase())) {
        const evidence = await client.query("SELECT 1 FROM evidence_records WHERE evidence_id = $1 AND project_id = $2 AND goal_id = $3", [sourceId, current.sourceProjectId, current.sourceGoalId]);
        if (evidence.rowCount !== 1) throw new OrganizationalKnowledgeError("corroborating evidence is missing or outside source Goal");
      } else if (current.sourceDigestIds.includes(sourceId.toLowerCase())) {
        const digest = await client.query("SELECT 1 FROM improvement_digests WHERE digest_id = $1 AND project_id = $2 AND goal_id = $3", [sourceId, current.sourceProjectId, current.sourceGoalId]);
        if (digest.rowCount !== 1) throw new OrganizationalKnowledgeError("corroborating digest is missing or outside source Goal");
      } else throw new OrganizationalKnowledgeError("corroborating source is not bound to the lesson");
    }
    if (request.corroboratingSourceIds.length !== request.corroboratingEpisodeIds.length || new Set(request.corroboratingEpisodeIds.map((id) => id.toLowerCase())).size !== request.corroboratingEpisodeIds.length) throw new OrganizationalKnowledgeError("corroborating episodes must be distinct and paired with sources");
    const episodes = await client.query<{ digest_id: string; episode_id: string }>("SELECT digest_id, episode_id FROM improvement_digests WHERE digest_id = ANY($1::uuid[]) AND project_id = $2 AND goal_id = $3", [request.corroboratingSourceIds, current.sourceProjectId, current.sourceGoalId]);
    if (episodes.rowCount !== request.corroboratingSourceIds.length || episodes.rows.some((row) => !request.corroboratingSourceIds.some((id, index) => id.toLowerCase() === row.digest_id.toLowerCase() && request.corroboratingEpisodeIds[index]?.toLowerCase() === row.episode_id.toLowerCase()))) throw new OrganizationalKnowledgeError("corroborating episode is not bound to its durable digest source");
    const approved = approval.rowCount === 1;
    const promotion: GlobalKnowledgePromotion = { encoreCouncilApproved: approved, corroboratingSourceIds: sourceIds, corroboratingEpisodeIds: request.corroboratingEpisodeIds, generalizedStatement: request.generalizedStatement, curatorRoleId: request.curatorRoleId, councilRoundId: request.encoreCouncilRoundId };
    const promoted = promoteKnowledgeToGlobal(current, promotion);
    const stored = await insertRevision(client, promoted, request.promoterRoleId, `promotion:${request.promoterRoleId}`);
    return publicProjection(stored);
  });
}

export async function listOrganizationalKnowledge(pool: Pool, authorization: OrganizationalKnowledgeReadAuthorization): Promise<readonly (OrganizationalKnowledge | OrganizationalKnowledgePublic)[]> {
  if (!authorization || typeof authorization.operatorId !== "string" || typeof authorization.projectId !== "string" || typeof authorization.departmentId !== "string") throw new OrganizationalKnowledgeError("knowledge read authorization is required");
  const client = await pool.connect();
  try { await client.query("BEGIN"); await assertProjectMembership(client, authorization.operatorId, authorization.projectId);
    const result = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge k WHERE k.status <> 'retired' AND (k.scope = 'global' OR (k.project_id = $1 AND k.scope = 'project_department')) AND k.department_id = $2 AND k.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = k.knowledge_id) ORDER BY k.created_at, k.knowledge_id`, [authorization.projectId, authorization.departmentId]);
    await client.query("COMMIT"); return result.rows.map((row) => { const lesson = map(row); return lesson.scope === "global" ? publicProjection(lesson) : lesson; });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Appends a stale/contradicted score revision; the prior claim remains auditable. */
export async function refreshOrganizationalKnowledge(pool: Pool, request: { readonly knowledgeId: string; readonly now: string; readonly lastSupportedAt: string; readonly staleAfterMs?: number; readonly contradicted?: boolean; readonly actorId: string }): Promise<OrganizationalKnowledge> {
  if (request.actorId !== "knowledge-decay-system") throw new OrganizationalKnowledgeError("knowledge decay is restricted to the knowledge-decay system actor");
  return withKnowledgeTransaction(pool, async (client) => {
    const current = await readCurrent(client, request.knowledgeId, true);
    const decayed = decayKnowledge(current, { now: request.now, lastSupportedAt: request.lastSupportedAt, ...(request.staleAfterMs === undefined ? {} : { staleAfterMs: request.staleAfterMs }), ...(request.contradicted === undefined ? {} : { contradicted: request.contradicted }) });
    if (decayed.revision === current.revision) return current;
    return insertRevision(client, decayed, "knowledge-decay", "system:knowledge-decay");
  });
}

export async function markKnowledgeUnsupportedForEvidence(pool: Pool, evidenceId: string, reason: string, actorId: string): Promise<readonly string[]> {
  if (actorId !== "evidence-source-loss" || !/^[-0-9a-f]{36}$/i.test(evidenceId) || reason.trim() === "") throw new OrganizationalKnowledgeError("evidence id and reason are required");
  return withKnowledgeTransaction(pool, async (client) => {
    const rows = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge k WHERE k.status NOT IN ('retired','unsupported') AND k.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = k.knowledge_id) AND k.source_evidence_ids @> $1::jsonb FOR UPDATE`, [JSON.stringify([evidenceId.toLowerCase()])]);
    const ids: string[] = [];
    for (const row of rows.rows) { const current = map(row); const unsupported = retireKnowledge(current, { status: "unsupported", reason }); await insertRevision(client, unsupported, "evidence-system", `evidence:${evidenceId}`); ids.push(current.knowledgeId); }
    return ids;
  });
}

export async function markKnowledgeUnsupportedForDigest(pool: Pool, digestId: string, reason: string, actorId: string): Promise<readonly string[]> {
  if (actorId !== "evidence-source-loss" || !/^[-0-9a-f]{36}$/i.test(digestId) || reason.trim() === "") throw new OrganizationalKnowledgeError("digest source loss request is invalid");
  return withKnowledgeTransaction(pool, async (client) => {
    const rows = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge k WHERE k.status NOT IN ('retired','unsupported') AND k.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = k.knowledge_id) AND k.source_digest_ids @> $1::jsonb FOR UPDATE`, [JSON.stringify([digestId.toLowerCase()])]);
    const ids: string[] = [];
    for (const row of rows.rows) { const current = map(row); const unsupported = retireKnowledge(current, { status: "unsupported", reason }); await insertRevision(client, unsupported, "evidence-source-loss", `digest:${digestId}`); ids.push(current.knowledgeId); }
    return ids;
  });
}

export async function retireOrganizationalKnowledge(pool: Pool, request: { readonly knowledgeId: string; readonly reason: string; readonly retiredBy: string }): Promise<OrganizationalKnowledge> {
  return withKnowledgeTransaction(pool, async (client) => {
    const current = await readCurrent(client, request.knowledgeId, true);
    await assertHead(client, request.retiredBy, current.departmentId);
    // A retry after the durable retirement is an acknowledgement, not a new
    // mutation. The original retired row remains the provenance record.
    if (current.status === "retired") return current;
    const retired = retireKnowledge(current, { status: "retired", reason: request.reason });
    return insertRevision(client, retired, request.retiredBy, `retirement:${request.retiredBy}`);
  });
}
