import { createHash, randomUUID } from "node:crypto";
import {
  assertValidOrganizationalKnowledgeProposal, createWorkerProposedKnowledge, decayOrganizationalKnowledge as decayKnowledge, promoteKnowledgeToGlobal, promoteKnowledgeToProject,
  retireOrganizationalKnowledge as retireKnowledge, type GlobalKnowledgePromotion, type OrganizationalKnowledge,
  type OrganizationalKnowledgeProposal, type OrganizationalKnowledgeStatus,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";
import type { GoalLeaseProof } from "./commands.js";
import { withGoalAuthority } from "./goal-authority.js";
import { assertProjectMembership, assertProjectRole } from "./project-membership.js";

export type OrganizationalKnowledgeProposalRecord = OrganizationalKnowledgeProposal;
export interface OrganizationalKnowledgeAuthor { readonly actorId: string; readonly sessionRef: string; readonly operatorId: string; readonly operatorRoleId: string; }
export interface OrganizationalKnowledgeReadAuthorization { readonly operatorId: string; readonly projectId: string; readonly departmentId: string; readonly proof: GoalLeaseProof; }
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
  council_round_id: string | null; generalized_statement: string | null; curator_role_id: string | null; curator_operator_id: string | null; curator_department_id: string | null; author_operator_id: string | null; author_role_id: string | null; operation_payload_hash: string | null; promotion_operator_id: string | null; promotion_role_id: string | null; promotion_marker: string; reason: string | null; created_by: string; source_session_ref: string; created_at: Date; retention?: string;
}
const COLUMNS = "knowledge_id, revision, schema_version, source_project_id, project_id, source_goal_id, department_id, scope, status, statement, rationale, source_evidence_ids, source_digest_ids, episode_ids, confidence, freshness, generalized, council_round_id, generalized_statement, curator_role_id, curator_operator_id, curator_department_id, author_operator_id, author_role_id, operation_payload_hash, promotion_operator_id, promotion_role_id, promotion_marker, reason, created_by, source_session_ref, created_at, retention";
const INSERT_COLUMNS = COLUMNS.replace(", created_at", "");

function operationHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
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
    ...(row.curator_operator_id === null ? {} : { curatorOperatorId: row.curator_operator_id }),
    ...(row.curator_department_id === null ? {} : { curatorDepartmentId: row.curator_department_id }),
    ...(row.author_operator_id === null ? {} : { authorOperatorId: row.author_operator_id }),
    ...(row.author_role_id === null ? {} : { authorRoleId: row.author_role_id }),
    ...(row.operation_payload_hash === null ? {} : { operationPayloadHash: row.operation_payload_hash }),
    ...(row.promotion_operator_id === null ? {} : { promotionOperatorId: row.promotion_operator_id }),
    ...(row.promotion_role_id === null ? {} : { promotionRoleId: row.promotion_role_id }),
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
async function authorizePromotion(client: Pick<PoolClient, "query">, lesson: OrganizationalKnowledge, roleId: string, operatorId: string, proof: GoalLeaseProof, curatorOperatorId?: string, curatorRoleId?: string): Promise<void> {
  await client.query("SELECT authorize_knowledge_promotion($1, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9::uuid, $10, $11::bigint, $12::uuid, $13)", [randomUUID(), lesson.knowledgeId, lesson.revision, lesson.scope, roleId, lesson.departmentId, operatorId, lesson.sourceProjectId, lesson.sourceGoalId, proof.ownerId, proof.fencingToken, curatorOperatorId ?? null, curatorRoleId ?? null]);
}

async function authorizeMaintenance(client: Pick<PoolClient, "query">, lesson: OrganizationalKnowledge, status: "unsupported" | "contradicted" | "retired", operatorId: string, roleId: string, proof: GoalLeaseProof, reason: string, sourceSessionRef: string): Promise<void> {
  await client.query("SELECT authorize_knowledge_maintenance($1, $2, $3, $4, $5::uuid, $6, $7, $8::bigint, $9, $10)", [randomUUID(), lesson.knowledgeId, lesson.revision, status, operatorId, roleId, proof.ownerId, proof.fencingToken, reason, sourceSessionRef]);
}

async function insertRevision(client: Pick<PoolClient, "query">, lesson: OrganizationalKnowledge, createdBy: string, sourceSessionRef: string, authorOperatorId?: string, authorRoleId?: string, operationPayloadHash?: string, promotionOperatorId?: string, promotionRoleId?: string): Promise<OrganizationalKnowledge> {
  const prior = lesson.revision > 1 ? await client.query<{ retention: string }>("SELECT retention FROM organizational_knowledge WHERE knowledge_id = $1 AND revision = $2", [lesson.knowledgeId, lesson.revision - 1]) : { rows: [] as { retention: string }[] };
  const retention = prior.rows[0]?.retention ?? "project_lifetime";
  const result = await client.query<KnowledgeRow>(
    `INSERT INTO organizational_knowledge (${INSERT_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32) RETURNING ${COLUMNS}`,
    [lesson.knowledgeId, lesson.revision, lesson.schemaVersion, lesson.sourceProjectId, lesson.projectId, lesson.sourceGoalId, lesson.departmentId, lesson.scope, lesson.status, lesson.statement, lesson.rationale, JSON.stringify(lesson.sourceEvidenceIds), JSON.stringify(lesson.sourceDigestIds), JSON.stringify(lesson.episodeIds), lesson.confidence, lesson.freshness, lesson.generalized, lesson.councilRoundId, lesson.generalizedStatement ?? null, lesson.curatorRoleId ?? null, lesson.curatorOperatorId ?? null, lesson.curatorDepartmentId ?? null, authorOperatorId ?? lesson.authorOperatorId ?? null, authorRoleId ?? lesson.authorRoleId ?? null, operationPayloadHash ?? lesson.operationPayloadHash ?? null, promotionOperatorId ?? lesson.promotionOperatorId ?? null, promotionRoleId ?? lesson.promotionRoleId ?? null, marker(lesson), lesson.reason, createdBy, sourceSessionRef, retention],
  );
  return map(result.rows[0]!);
}

/** Stores worker evidence as a proposal. This operation cannot create an active organizational lesson. */
export async function proposeOrganizationalKnowledge(pool: Pool, input: OrganizationalKnowledgeProposal, proof: GoalLeaseProof, author: OrganizationalKnowledgeAuthor, idempotencyKey?: string): Promise<OrganizationalKnowledge> {
  if (idempotencyKey === undefined || idempotencyKey.trim() === "") throw new OrganizationalKnowledgeError("proposal idempotency key is required");
  assertValidOrganizationalKnowledgeProposal(input); authorValue(author);
  if (proof.goalId !== input.sourceGoalId) throw new OrganizationalKnowledgeError("knowledge source Goal does not match lease proof");
  if (author.operatorId.trim() === "") throw new OrganizationalKnowledgeError("proposal requires an operator identity");
  if (author.actorId.trim() !== proof.ownerId) throw new OrganizationalKnowledgeError("proposal author does not match Goal lease owner");
  const proposal = createWorkerProposedKnowledge(input);
  return withGoalAuthority(pool, proof, 63, async (client) => {
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [author.operatorId]);
    if (operator.rowCount !== 1) throw new OrganizationalKnowledgeError("proposal requires an active operator");
    await assertProjectMembership(client, author.operatorId, input.projectId);
    await assertProjectRole(client, author.operatorId, input.projectId, author.operatorRoleId);
    const operationRef = `proposal:${idempotencyKey.trim()}`;
    if (operationRef.length === 0 || operationRef.length > 256) throw new OrganizationalKnowledgeError("proposal idempotency key is invalid");
    const replay = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge WHERE source_session_ref = $1 AND source_project_id = $2 AND source_goal_id = $3 AND revision = 1`, [operationRef, input.projectId, input.sourceGoalId]);
    if (replay.rowCount === 1) {
      const prior = map(replay.rows[0]!);
      const same = prior.createdBy === author.actorId.trim() && prior.authorOperatorId === author.operatorId && prior.authorRoleId === author.operatorRoleId && prior.statement === proposal.statement && prior.rationale === proposal.rationale && JSON.stringify(prior.sourceEvidenceIds) === JSON.stringify(proposal.sourceEvidenceIds) && JSON.stringify(prior.sourceDigestIds) === JSON.stringify(proposal.sourceDigestIds) && JSON.stringify(prior.episodeIds) === JSON.stringify(proposal.episodeIds) && prior.departmentId === proposal.departmentId && prior.confidence === proposal.confidence && prior.freshness === proposal.freshness && prior.generalized === proposal.generalized;
      if (!same) throw new OrganizationalKnowledgeError("conflicting knowledge proposal replay");
      return prior;
    }
    const payload = { projectId: input.projectId, goalId: input.sourceGoalId, departmentId: input.departmentId, statement: proposal.statement, rationale: proposal.rationale, sourceEvidenceIds: proposal.sourceEvidenceIds, sourceDigestIds: proposal.sourceDigestIds, episodeIds: proposal.episodeIds, confidence: proposal.confidence, freshness: proposal.freshness, generalized: proposal.generalized };
    await client.query("SELECT authorize_knowledge_proposal($1, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::bigint, $9, $10, $11::jsonb)", [randomUUID(), proposal.knowledgeId, input.projectId, input.sourceGoalId, author.operatorId, author.operatorRoleId, proof.ownerId, proof.fencingToken, author.actorId.trim(), operationRef, JSON.stringify(payload)]);
    return insertRevision(client, proposal, author.actorId.trim(), operationRef, author.operatorId, author.operatorRoleId);
  });
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

async function assertStandingHead(client: Pick<PoolClient, "query">, roleId: string): Promise<string> {
  const result = await client.query<{ department_id: string | null }>("SELECT department_id FROM permanent_roles WHERE role_id = $1 AND role_kind = 'department_head' AND status = 'standing'", [roleId.trim()]);
  const departmentId = result.rows[0]?.department_id;
  if (departmentId === undefined || departmentId === null) throw new OrganizationalKnowledgeError("Department Head identity is invalid");
  return departmentId;
}

export async function promoteOrganizationalKnowledgeToProject(pool: Pool, request: { readonly knowledgeId: string; readonly promoterRoleId: string; readonly promoterOperatorId: string; readonly departmentId: string; readonly proof: GoalLeaseProof; readonly idempotencyKey?: string }): Promise<OrganizationalKnowledge> {
  return withGoalAuthority(pool, request.proof, 91, async (client) => {
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [request.promoterOperatorId]);
    if (operator.rowCount !== 1) throw new OrganizationalKnowledgeError("promotion requires an active operator");
    await assertHead(client, request.promoterRoleId, request.departmentId);
    const current = await readCurrent(client, request.knowledgeId, true);
    if (current.sourceGoalId !== request.proof.goalId) throw new OrganizationalKnowledgeError("knowledge source Goal is outside the lease");
    await assertProjectRole(client, request.promoterOperatorId, current.sourceProjectId, request.promoterRoleId);
    if (request.idempotencyKey === undefined || request.idempotencyKey.trim() === "") throw new OrganizationalKnowledgeError("promotion idempotency key is required");
    const operationRef = `promotion:${request.idempotencyKey.trim()}`;
    if (operationRef.length > 256) throw new OrganizationalKnowledgeError("promotion idempotency key is invalid");
    if (current.scope === "project_department" && current.status === "active") {
      if ((request.idempotencyKey !== undefined && current.sourceSessionRef !== operationRef) || current.createdBy?.trim() !== request.promoterRoleId.trim() || current.promotionOperatorId?.toLowerCase() !== request.promoterOperatorId.toLowerCase() || current.sourceProjectId.toLowerCase() !== current.projectId?.toLowerCase() || current.departmentId !== request.departmentId) throw new OrganizationalKnowledgeError("conflicting project promotion retry");
      return current;
    }
    const promoted = promoteKnowledgeToProject(current, { promoterRoleKind: "department_head", promoterDepartmentId: request.departmentId });
    await authorizePromotion(client, promoted, request.promoterRoleId, request.promoterOperatorId, request.proof);
    return insertRevision(client, promoted, request.promoterRoleId, operationRef, undefined, undefined, undefined, request.promoterOperatorId, request.promoterRoleId);
  });
}

export async function promoteOrganizationalKnowledgeToGlobal(pool: Pool, request: { readonly knowledgeId: string; readonly promoterRoleId: string; readonly promoterOperatorId: string; readonly departmentId: string; readonly proof: GoalLeaseProof; readonly encoreCouncilRoundId: string; readonly corroboratingSourceIds: readonly string[]; readonly corroboratingEpisodeIds: readonly string[]; readonly generalizedStatement: string; readonly curatorRoleId: string; readonly curatorOperatorId: string; readonly idempotencyKey?: string }): Promise<OrganizationalKnowledgePublic> {
  return withGoalAuthority(pool, request.proof, 92, async (client) => {
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [request.promoterOperatorId]);
    if (operator.rowCount !== 1) throw new OrganizationalKnowledgeError("promotion requires an active operator");
    if (request.curatorOperatorId.trim().toLowerCase() === request.promoterOperatorId.trim().toLowerCase()) throw new OrganizationalKnowledgeError("curator operator must be independent from promoter operator");
    if (request.curatorRoleId.trim().toLowerCase() === request.promoterRoleId.trim().toLowerCase()) throw new OrganizationalKnowledgeError("curator role must be independent from promoter role");
    await assertHead(client, request.promoterRoleId, request.departmentId);
    const current = await readCurrent(client, request.knowledgeId, true);
    if (current.sourceGoalId !== request.proof.goalId) throw new OrganizationalKnowledgeError("knowledge source Goal is outside the lease");
    await assertProjectRole(client, request.promoterOperatorId, current.sourceProjectId, request.promoterRoleId);
    const curatorDepartmentId = await assertStandingHead(client, request.curatorRoleId);
    const retryCurator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [request.curatorOperatorId]);
    if (retryCurator.rowCount !== 1) throw new OrganizationalKnowledgeError("curator requires an active operator");
    await assertProjectMembership(client, request.curatorOperatorId, current.sourceProjectId);
    await assertProjectRole(client, request.curatorOperatorId, current.sourceProjectId, request.curatorRoleId);
    if (request.idempotencyKey === undefined || request.idempotencyKey.trim() === "") throw new OrganizationalKnowledgeError("promotion idempotency key is required");
    const operationRef = `promotion:${request.idempotencyKey.trim()}`;
    if (operationRef.length > 256) throw new OrganizationalKnowledgeError("promotion idempotency key is invalid");
    if (current.scope === "global") {
      const same = current.sourceSessionRef === operationRef && current.promotionOperatorId?.toLowerCase() === request.promoterOperatorId.toLowerCase() && current.promotionRoleId?.toLowerCase() === request.promoterRoleId.toLowerCase() && current.generalizedStatement === request.generalizedStatement && current.councilRoundId?.toLowerCase() === request.encoreCouncilRoundId.toLowerCase() && current.curatorRoleId?.toLowerCase() === request.curatorRoleId.toLowerCase() && current.curatorOperatorId?.toLowerCase() === request.curatorOperatorId.toLowerCase() && current.curatorDepartmentId?.toLowerCase() === curatorDepartmentId.toLowerCase() && JSON.stringify(current.sourceDigestIds) === JSON.stringify(request.corroboratingSourceIds.map((id) => id.toLowerCase())) && JSON.stringify(current.episodeIds) === JSON.stringify(request.corroboratingEpisodeIds.map((id) => id.toLowerCase()));
      if (!same) throw new OrganizationalKnowledgeError("conflicting global promotion retry");
      return publicProjection(current);
    }
    await assertStandingHead(client, request.curatorRoleId);
    const curatorOperator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [request.curatorOperatorId]);
    if (curatorOperator.rowCount !== 1) throw new OrganizationalKnowledgeError("curator requires an active operator");
    await assertProjectMembership(client, request.curatorOperatorId, current.sourceProjectId);
    await assertProjectRole(client, request.curatorOperatorId, current.sourceProjectId, request.curatorRoleId);
    if (request.curatorRoleId === request.promoterRoleId) throw new OrganizationalKnowledgeError("global generalization requires an independent Department Head curator");
    const sourceIds = request.corroboratingSourceIds;
    if (!Array.isArray(sourceIds) || !Array.isArray(request.corroboratingEpisodeIds) || sourceIds.length < 2 || sourceIds.some((id) => !current.sourceDigestIds.includes(id.toLowerCase()))) throw new OrganizationalKnowledgeError("global corroboration must use bound Improvement Digest sources");
    const approval = await client.query<{ final_verdict: string }>(
      `SELECT s.final_verdict FROM encore_council_rounds r JOIN encore_council_syntheses s ON s.round_id = r.round_id
        WHERE r.round_id = $1 AND r.goal_id = $2 AND s.final_verdict = 'proceed' AND s.same_model_only = false
          AND (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(r.evidence_ids)) = (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text($3::jsonb))
          AND (SELECT count(*) FROM encore_council_judgments j WHERE j.round_id = r.round_id) = r.reviewer_count
          AND (SELECT count(DISTINCT j.reviewer_index) FROM encore_council_judgments j WHERE j.round_id = r.round_id) = r.reviewer_count
          AND (SELECT min(j.reviewer_index) FROM encore_council_judgments j WHERE j.round_id = r.round_id) = 0
          AND (SELECT max(j.reviewer_index) FROM encore_council_judgments j WHERE j.round_id = r.round_id) = r.reviewer_count - 1
          AND NOT EXISTS (SELECT 1 FROM encore_council_judgments j WHERE j.round_id = r.round_id AND j.verdict <> 'proceed')
          AND NOT EXISTS (SELECT 1 FROM encore_council_judgments j WHERE j.round_id = r.round_id AND (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(j.cited_evidence_ids)) IS DISTINCT FROM (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text($3::jsonb)))
          AND (SELECT count(DISTINCT (j.model_provider || ':' || j.model_id)) FROM encore_council_judgments j WHERE j.round_id = r.round_id) >= 2
          AND (SELECT count(DISTINCT j.judgment_id) FROM encore_council_judgments j JOIN native_execution_bindings b ON b.execution_ref = j.execution_ref AND b.invocation_ref = j.invocation_ref AND b.goal_id = r.goal_id AND b.project_id = $4 AND b.admission_kind = 'encore_reviewer' AND b.actual_model_provider = j.model_provider AND b.actual_model_id = j.model_id WHERE j.round_id = r.round_id) = r.reviewer_count`,
      [request.encoreCouncilRoundId, current.sourceGoalId, JSON.stringify(sourceIds), current.sourceProjectId],
    );
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
    const promotion: GlobalKnowledgePromotion = { encoreCouncilApproved: approved, corroboratingSourceIds: sourceIds, corroboratingEpisodeIds: request.corroboratingEpisodeIds, generalizedStatement: request.generalizedStatement, curatorRoleId: request.curatorRoleId, curatorOperatorId: request.curatorOperatorId, curatorDepartmentId, councilRoundId: request.encoreCouncilRoundId };
    const promoted = promoteKnowledgeToGlobal(current, promotion);
    await authorizePromotion(client, promoted, request.promoterRoleId, request.promoterOperatorId, request.proof, request.curatorOperatorId, request.curatorRoleId);
    const stored = await insertRevision(client, promoted, request.promoterRoleId, operationRef, undefined, undefined, undefined, request.promoterOperatorId, request.promoterRoleId);
    return publicProjection(stored);
  });
}

export async function listOrganizationalKnowledge(pool: Pool, authorization: OrganizationalKnowledgeReadAuthorization): Promise<readonly (OrganizationalKnowledge | OrganizationalKnowledgePublic)[]> {
  if (!authorization || typeof authorization.operatorId !== "string" || typeof authorization.projectId !== "string" || typeof authorization.departmentId !== "string") throw new OrganizationalKnowledgeError("knowledge read authorization is required");
  return withGoalAuthority(pool, authorization.proof, 93, async (client) => {
    const goal = await client.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [authorization.proof.goalId]);
    if (goal.rowCount !== 1 || goal.rows[0]!.project_id !== authorization.projectId) throw new OrganizationalKnowledgeError("knowledge read Goal is outside requested project");
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [authorization.operatorId]);
    if (operator.rowCount !== 1) throw new OrganizationalKnowledgeError("knowledge read requires an active operator");
    await assertProjectMembership(client, authorization.operatorId, authorization.projectId); await assertProjectRole(client, authorization.operatorId, authorization.projectId, authorization.departmentId);
    const result = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge k WHERE k.status <> 'retired' AND (k.scope = 'global' OR (k.project_id = $1 AND k.scope = 'project_department')) AND k.department_id = $2 AND k.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = k.knowledge_id) ORDER BY k.created_at, k.knowledge_id`, [authorization.projectId, authorization.departmentId]);
    return result.rows.map((row) => { const lesson = map(row); return lesson.scope === "global" ? publicProjection(lesson) : lesson; });
  });
}

/** Appends a stale/contradicted score revision; the prior claim remains auditable. */
export async function refreshOrganizationalKnowledge(pool: Pool, request: { readonly knowledgeId: string; readonly now: string; readonly lastSupportedAt: string; readonly staleAfterMs?: number; readonly contradicted?: boolean; readonly proof: GoalLeaseProof; readonly operatorId: string; readonly idempotencyKey: string }): Promise<OrganizationalKnowledge | OrganizationalKnowledgePublic> {
  return withGoalAuthority(pool, request.proof, 89, async (client) => {
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [request.operatorId]);
    if (operator.rowCount !== 1) throw new OrganizationalKnowledgeError("knowledge maintenance requires an active operator");
    const current = await readCurrent(client, request.knowledgeId, true);
    if (current.sourceGoalId !== request.proof.goalId) throw new OrganizationalKnowledgeError("knowledge source Goal is outside the lease");
    await assertProjectMembership(client, request.operatorId, current.sourceProjectId);
    await assertProjectRole(client, request.operatorId, current.sourceProjectId, current.departmentId);
    if (request.idempotencyKey.trim() === "") throw new OrganizationalKnowledgeError("knowledge maintenance idempotency key is required");
    const operationRef = `system:knowledge-decay:${request.idempotencyKey.trim()}`;
    const requestHash = operationHash({ now: request.now, lastSupportedAt: request.lastSupportedAt, staleAfterMs: request.staleAfterMs ?? null, contradicted: request.contradicted ?? null });
    if (operationRef.length > 256) throw new OrganizationalKnowledgeError("knowledge maintenance idempotency key is invalid");
    if (current.sourceSessionRef === operationRef) {
      if (current.promotionOperatorId?.toLowerCase() !== request.operatorId.toLowerCase() || current.promotionRoleId?.toLowerCase() !== current.departmentId.toLowerCase() || current.operationPayloadHash !== requestHash) throw new OrganizationalKnowledgeError("conflicting knowledge maintenance retry");
      return current.scope === "global" ? publicProjection(current) : current;
    }
    if (current.sourceSessionRef?.startsWith("system:knowledge-decay:") && current.status !== "retired") throw new OrganizationalKnowledgeError("conflicting knowledge maintenance retry");
    if (current.status === "retired") return current.scope === "global" ? publicProjection(current) : current;
    const decayed = decayKnowledge(current, { now: request.now, lastSupportedAt: request.lastSupportedAt, ...(request.staleAfterMs === undefined ? {} : { staleAfterMs: request.staleAfterMs }), ...(request.contradicted === undefined ? {} : { contradicted: request.contradicted }) });
    if (decayed.revision === current.revision) return current.scope === "global" ? publicProjection(current) : current;
    const maintenanceAuthor = current.createdBy;
    if (maintenanceAuthor === undefined) throw new OrganizationalKnowledgeError("knowledge maintenance requires durable source author");
    const maintained = { ...decayed, createdBy: maintenanceAuthor, sourceSessionRef: operationRef };
    if (maintained.status === "active" && (maintained.scope === "project_department" || maintained.scope === "global")) await authorizePromotion(client, maintained, maintenanceAuthor, request.operatorId, request.proof, maintained.curatorOperatorId, maintained.curatorRoleId);
    if (maintained.status === "unsupported" || maintained.status === "contradicted" || maintained.status === "retired") await authorizeMaintenance(client, maintained, maintained.status, request.operatorId, current.departmentId, request.proof, maintained.reason!, operationRef);
    const stored = await insertRevision(client, maintained, maintenanceAuthor, operationRef, undefined, undefined, requestHash, request.operatorId, current.departmentId);
    return stored.scope === "global" ? publicProjection(stored) : stored;
  });
}

export async function markKnowledgeUnsupportedForEvidence(pool: Pool, evidenceId: string, reason: string, proof: GoalLeaseProof, operatorId: string, operatorRoleId: string): Promise<readonly string[]> {
  if (!/^[0-9a-f-]{36}$/i.test(evidenceId) || reason.trim() === "" || operatorId.trim() === "") throw new OrganizationalKnowledgeError("evidence source loss request is invalid");
  return withGoalAuthority(pool, proof, 88, async (client) => {
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [operatorId]);
    if (operator.rowCount !== 1) throw new OrganizationalKnowledgeError("source loss requires an active operator");
    const source = await client.query<{ goal_id: string; project_id: string; goal_project_id: string }>("SELECT e.goal_id, e.project_id, g.project_id AS goal_project_id FROM evidence_records e JOIN goals g ON g.goal_id = e.goal_id WHERE e.evidence_id = $1", [evidenceId.toLowerCase()]);
    if (source.rowCount !== 1 || source.rows[0]!.goal_id !== proof.goalId || source.rows[0]!.project_id !== source.rows[0]!.goal_project_id) throw new OrganizationalKnowledgeError("evidence source is outside the Goal lease/project");
    await assertProjectMembership(client, operatorId, source.rows[0]!.project_id);
    await assertProjectRole(client, operatorId, source.rows[0]!.project_id, operatorRoleId);
    const criticalRole = await client.query("SELECT 1 FROM permanent_roles WHERE role_id = $1 AND role_kind IN ('department_head', 'ceo') AND status = 'standing'", [operatorRoleId]);
    if (criticalRole.rowCount !== 1) throw new OrganizationalKnowledgeError("source loss requires a standing Department Head or CEO role");
    const rows = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge k WHERE k.status NOT IN ('retired','unsupported') AND k.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = k.knowledge_id) AND k.source_evidence_ids @> $1::jsonb FOR UPDATE`, [JSON.stringify([evidenceId.toLowerCase()])]);
    const ids: string[] = [];
    for (const row of rows.rows) { const current = map(row); const unsupported = retireKnowledge(current, { status: "unsupported", reason }); await authorizeMaintenance(client, unsupported, "unsupported", operatorId, operatorRoleId, proof, reason, `evidence:${evidenceId}`); await insertRevision(client, unsupported, operatorId, `evidence:${evidenceId}`); ids.push(current.knowledgeId); }
    return ids;
  });
}

export async function markKnowledgeUnsupportedForDigest(pool: Pool, digestId: string, reason: string, proof: GoalLeaseProof, operatorId: string, operatorRoleId: string): Promise<readonly string[]> {
  if (!/^[-0-9a-f]{36}$/i.test(digestId) || reason.trim() === "") throw new OrganizationalKnowledgeError("digest source loss request is invalid");
  return withGoalAuthority(pool, proof, 88, async (client) => {
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [operatorId]);
    if (operator.rowCount !== 1) throw new OrganizationalKnowledgeError("source loss requires an active operator");
    const digest = await client.query<{ goal_id: string; project_id: string; goal_project_id: string }>("SELECT d.goal_id, d.project_id, g.project_id AS goal_project_id FROM improvement_digests d JOIN goals g ON g.goal_id = d.goal_id WHERE d.digest_id = $1", [digestId.toLowerCase()]);
    if (digest.rowCount !== 1 || digest.rows[0]!.goal_id !== proof.goalId || digest.rows[0]!.project_id !== digest.rows[0]!.goal_project_id) throw new OrganizationalKnowledgeError("digest source is outside the Goal lease/project");
    await assertProjectMembership(client, operatorId, digest.rows[0]!.project_id);
    await assertProjectRole(client, operatorId, digest.rows[0]!.project_id, operatorRoleId);
    const criticalRole = await client.query("SELECT 1 FROM permanent_roles WHERE role_id = $1 AND role_kind IN ('department_head', 'ceo') AND status = 'standing'", [operatorRoleId]);
    if (criticalRole.rowCount !== 1) throw new OrganizationalKnowledgeError("source loss requires a standing Department Head or CEO role");
    const rows = await client.query<KnowledgeRow>(`SELECT ${COLUMNS} FROM organizational_knowledge k WHERE k.status NOT IN ('retired','unsupported') AND k.revision = (SELECT max(latest.revision) FROM organizational_knowledge latest WHERE latest.knowledge_id = k.knowledge_id) AND k.source_digest_ids @> $1::jsonb FOR UPDATE`, [JSON.stringify([digestId.toLowerCase()])]);
    const ids: string[] = [];
    for (const row of rows.rows) { const current = map(row); const unsupported = retireKnowledge(current, { status: "unsupported", reason }); await authorizeMaintenance(client, unsupported, "unsupported", operatorId, operatorRoleId, proof, reason, `digest:${digestId}`); await insertRevision(client, unsupported, operatorId, `digest:${digestId}`); ids.push(current.knowledgeId); }
    return ids;
  });
}

export async function retireOrganizationalKnowledge(pool: Pool, request: { readonly knowledgeId: string; readonly reason: string; readonly retiredBy: string; readonly proof: GoalLeaseProof; readonly operatorId: string; readonly idempotencyKey?: string }): Promise<OrganizationalKnowledge | OrganizationalKnowledgePublic> {
  return withGoalAuthority(pool, request.proof, 90, async (client) => {
    const operator = await client.query("SELECT 1 FROM local_operators WHERE operator_id = $1 AND active = true", [request.operatorId]);
    if (operator.rowCount !== 1) throw new OrganizationalKnowledgeError("knowledge retirement requires an active operator");
    if (request.idempotencyKey === undefined || request.idempotencyKey.trim() === "") throw new OrganizationalKnowledgeError("retirement idempotency key is required");
    const operationRef = `retirement:${request.idempotencyKey.trim()}`;
    if (operationRef.length > 256) throw new OrganizationalKnowledgeError("retirement idempotency key is invalid");
    const current = await readCurrent(client, request.knowledgeId, true);
    if (current.sourceGoalId !== request.proof.goalId) throw new OrganizationalKnowledgeError("knowledge source Goal is outside the lease");
    await assertHead(client, request.retiredBy, current.departmentId);
    await assertProjectRole(client, request.operatorId, current.sourceProjectId, request.retiredBy);
    // A retry acknowledges only the exact durable retirement command.
    if (current.status === "retired") {
      if (current.sourceSessionRef !== operationRef || current.reason !== request.reason || current.createdBy !== request.retiredBy || current.promotionOperatorId?.toLowerCase() !== request.operatorId.toLowerCase() || current.promotionRoleId?.toLowerCase() !== request.retiredBy.toLowerCase()) throw new OrganizationalKnowledgeError("conflicting knowledge retirement retry");
      return current.scope === "global" ? publicProjection(current) : current;
    }
    const retired = retireKnowledge(current, { status: "retired", reason: request.reason });
    await authorizeMaintenance(client, retired, "retired", request.operatorId, request.retiredBy, request.proof, retired.reason!, operationRef);
    const stored = await insertRevision(client, retired, request.retiredBy, operationRef, undefined, undefined, undefined, request.operatorId, request.retiredBy);
    return stored.scope === "global" ? publicProjection(stored) : stored;
  });
}
