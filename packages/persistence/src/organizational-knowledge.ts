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
export interface OrganizationalKnowledgeReadAuthorization { readonly operatorId: string; readonly projectId: string; }
export class OrganizationalKnowledgeError extends Error {}
export class OrganizationalKnowledgeNotFoundError extends OrganizationalKnowledgeError {}

interface KnowledgeRow {
  knowledge_id: string; revision: number; schema_version: number; source_project_id: string; project_id: string | null; source_goal_id: string;
  department_id: string; scope: OrganizationalKnowledge["scope"]; status: OrganizationalKnowledgeStatus; statement: string; rationale: string;
  source_evidence_ids: string[]; source_digest_ids: string[]; episode_ids: string[]; confidence: number; freshness: number; generalized: boolean;
  council_round_id: string | null; reason: string | null; created_by: string; source_session_ref: string; created_at: Date;
}
const COLUMNS = "knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, reason, created_by, source_session_ref, created_at";
const INSERT_COLUMNS = COLUMNS.replace(", created_at", "");

function map(row: KnowledgeRow): OrganizationalKnowledge {
  const value: OrganizationalKnowledge = {
    schemaVersion: 1, knowledgeId: row.knowledge_id, revision: row.revision, sourceProjectId: row.source_project_id,
    projectId: row.project_id, sourceGoalId: row.source_goal_id, departmentId: row.department_id, scope: row.scope, status: row.status,
    statement: row.statement, rationale: row.rationale, sourceEvidenceIds: row.source_evidence_ids, sourceDigestIds: row.source_digest_ids,
    episodeIds: row.episode_ids, confidence: Number(row.confidence), freshness: Number(row.freshness), generalized: row.generalized,
    councilRoundId: row.council_round_id, reason: row.reason,
    createdAt: row.created_at.toISOString(), createdBy: row.created_by, sourceSessionRef: row.source_session_ref,
  };
  return Object.freeze({ ...value, sourceEvidenceIds: Object.freeze([...value.sourceEvidenceIds]), sourceDigestIds: Object.freeze([...value.sourceDigestIds]), episodeIds: Object.freeze([...value.episodeIds]) });
}
function authorValue(author: OrganizationalKnowledgeAuthor): void {
  if (!author || typeof author.actorId !== "string" || author.actorId.trim() === "" || author.actorId.length > 256 || typeof author.sessionRef !== "string" || author.sessionRef.trim() === "" || author.sessionRef.length > 256) throw new OrganizationalKnowledgeError("organizational knowledge author is invalid");
}
async function insertRevision(client: Pick<PoolClient, "query">, lesson: OrganizationalKnowledge, createdBy: string, sourceSessionRef: string): Promise<OrganizationalKnowledge> {
  const result = await client.query<KnowledgeRow>(
    `INSERT INTO organizational_knowledge (${INSERT_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21) RETURNING ${COLUMNS}`,
    [lesson.knowledgeId, lesson.revision, lesson.schemaVersion, lesson.sourceProjectId, lesson.projectId, lesson.sourceGoalId, lesson.departmentId, lesson.scope, lesson.status, lesson.statement, lesson.rationale, JSON.stringify(lesson.sourceEvidenceIds), JSON.stringify(lesson.sourceDigestIds), JSON.stringify(lesson.episodeIds), lesson.confidence, lesson.freshness, lesson.generalized, lesson.councilRoundId, lesson.reason, createdBy, sourceSessionRef],
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

export async function promoteOrganizationalKnowledgeToGlobal(pool: Pool, request: { readonly knowledgeId: string; readonly promoterRoleId: string; readonly departmentId: string; readonly encoreCouncilRoundId: string; readonly corroboratingEpisodeIds?: readonly string[] }): Promise<OrganizationalKnowledge> {
  return withKnowledgeTransaction(pool, async (client) => {
    await assertHead(client, request.promoterRoleId, request.departmentId);
    const current = await readCurrent(client, request.knowledgeId, true);
    const approval = await client.query<{ final_verdict: string }>("SELECT s.final_verdict FROM encore_council_syntheses s WHERE s.round_id = $1", [request.encoreCouncilRoundId]);
    const approved = approval.rows[0]?.final_verdict === "proceed";
    const promotion: GlobalKnowledgePromotion = { encoreCouncilApproved: approved, corroboratingEpisodeIds: [...current.episodeIds, ...(request.corroboratingEpisodeIds ?? [])], generalized: current.generalized, councilRoundId: request.encoreCouncilRoundId };
    const promoted = promoteKnowledgeToGlobal(current, promotion);
    return insertRevision(client, promoted, request.promoterRoleId, `promotion:${request.promoterRoleId}`);
  });
}

export async function listOrganizationalKnowledge(pool: Pool, authorization: OrganizationalKnowledgeReadAuthorization): Promise<readonly OrganizationalKnowledge[]> {
  if (!authorization || typeof authorization.operatorId !== "string" || typeof authorization.projectId !== "string") throw new OrganizationalKnowledgeError("knowledge read authorization is required");
  const client = await pool.connect();
  try { await client.query("BEGIN"); await assertProjectMembership(client, authorization.operatorId, authorization.projectId);
    const result = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge k WHERE k.status <> 'retired' AND (k.scope = 'global' OR (k.project_id = $1 AND k.scope = 'project_department')) AND k.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = k.knowledge_id) ORDER BY k.created_at, k.knowledge_id`, [authorization.projectId]);
    await client.query("COMMIT"); return result.rows.map(map);
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Appends a stale/contradicted score revision; the prior claim remains auditable. */
export async function refreshOrganizationalKnowledge(pool: Pool, request: { readonly knowledgeId: string; readonly now: string; readonly lastSupportedAt: string; readonly staleAfterMs?: number; readonly contradicted?: boolean }): Promise<OrganizationalKnowledge> {
  return withKnowledgeTransaction(pool, async (client) => {
    const current = await readCurrent(client, request.knowledgeId, true);
    const decayed = decayKnowledge(current, { now: request.now, lastSupportedAt: request.lastSupportedAt, ...(request.staleAfterMs === undefined ? {} : { staleAfterMs: request.staleAfterMs }), ...(request.contradicted === undefined ? {} : { contradicted: request.contradicted }) });
    if (decayed.revision === current.revision) return current;
    return insertRevision(client, decayed, "knowledge-decay", "system:knowledge-decay");
  });
}

export async function markKnowledgeUnsupportedForEvidence(pool: Pool, evidenceId: string, reason: string): Promise<readonly string[]> {
  if (!/^[-0-9a-f]{36}$/i.test(evidenceId) || reason.trim() === "") throw new OrganizationalKnowledgeError("evidence id and reason are required");
  return withKnowledgeTransaction(pool, async (client) => {
    const rows = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge k WHERE k.status NOT IN ('retired','unsupported') AND k.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = k.knowledge_id) AND k.source_evidence_ids @> $1::jsonb FOR UPDATE`, [JSON.stringify([evidenceId.toLowerCase()])]);
    const ids: string[] = [];
    for (const row of rows.rows) { const current = map(row); const unsupported = retireKnowledge(current, { status: "unsupported", reason }); await insertRevision(client, unsupported, "evidence-system", `evidence:${evidenceId}`); ids.push(current.knowledgeId); }
    return ids;
  });
}

export async function retireOrganizationalKnowledge(pool: Pool, request: { readonly knowledgeId: string; readonly reason: string; readonly retiredBy: string }): Promise<OrganizationalKnowledge> {
  return withKnowledgeTransaction(pool, async (client) => {
    const current = await readCurrent(client, request.knowledgeId, true);
    // A retry after the durable retirement is an acknowledgement, not a new
    // mutation. The original retired row remains the provenance record.
    if (current.status === "retired") return current;
    const retired = retireKnowledge(current, { status: "retired", reason: request.reason });
    return insertRevision(client, retired, request.retiredBy, `retirement:${request.retiredBy}`);
  });
}
