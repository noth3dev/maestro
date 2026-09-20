import { randomUUID } from "./hash.js";

export const ORGANIZATIONAL_KNOWLEDGE_SCHEMA_VERSION = 1 as const;
export type OrganizationalKnowledgeScope = "worker_proposed" | "project_department" | "global";
export type OrganizationalKnowledgeStatus = "proposed" | "active" | "unsupported" | "contradicted" | "retired";

export interface OrganizationalKnowledgeProposal {
  readonly schemaVersion: typeof ORGANIZATIONAL_KNOWLEDGE_SCHEMA_VERSION;
  readonly projectId: string;
  readonly sourceGoalId: string;
  readonly departmentId: string;
  readonly statement: string;
  readonly rationale: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly sourceDigestIds: readonly string[];
  readonly episodeIds: readonly string[];
  readonly confidence: number;
  readonly freshness: number;
  readonly generalized: boolean;
  /** Optional explicit attestation used by callers that have already screened a lesson. */
  readonly noRawProjectContent?: boolean;
  readonly noPersonalInformation?: boolean;
}

export interface OrganizationalKnowledge extends Omit<OrganizationalKnowledgeProposal, "projectId"> {
  readonly knowledgeId: string;
  readonly revision: number;
  readonly scope: OrganizationalKnowledgeScope;
  readonly status: OrganizationalKnowledgeStatus;
  readonly projectId: string | null;
  readonly sourceProjectId: string;
  readonly councilRoundId: string | null;
  readonly generalizedStatement?: string;
  readonly curatorRoleId?: string;
  readonly curatorOperatorId?: string;
  readonly curatorDepartmentId?: string;
  readonly authorOperatorId?: string;
  readonly authorRoleId?: string;
  readonly operationPayloadHash?: string;
  readonly promotionOperatorId?: string;
  readonly promotionRoleId?: string;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly createdBy?: string;
  readonly sourceSessionRef?: string;
  readonly retention?: string;
}

export interface DepartmentHeadPromotion {
  readonly promoterRoleKind: "department_head" | "worker";
  readonly promoterDepartmentId: string;
}
export interface GlobalKnowledgePromotion {
  readonly encoreCouncilApproved: boolean;
  /** Durable source records, each independently checked against the source Goal. */
  readonly corroboratingSourceIds: readonly string[];
  readonly corroboratingEpisodeIds: readonly string[];
  readonly generalizedStatement: string;
  readonly curatorRoleId: string;
  readonly curatorOperatorId?: string;
  readonly curatorDepartmentId?: string;
  readonly councilRoundId?: string;
}
export interface KnowledgeDecayOptions {
  readonly now: string;
  readonly lastSupportedAt: string;
  readonly staleAfterMs?: number;
  readonly contradicted?: boolean;
}

export class InvalidOrganizationalKnowledgeError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidOrganizationalKnowledgeError"; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;
const SECRET = /(?:authorization\s*:\s*bearer|bearer\s+|password\s*[:=]|passwd\s*[:=]|secret\s*[:=]|api[_-]?key\s*[:=]|access[_-]?token\s*[:=]|refresh[_-]?token\s*[:=]|private[_-]?key|credential\s*[:=]|-----BEGIN.*PRIVATE KEY-----|(?:^|[^a-z0-9])(?:sk|pk)-[a-z0-9_-]{16,}(?:$|[^a-z0-9])|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/i;
const RAW_PROJECT = /\b(raw|project-specific|source project|private project)\b/i;
const PERSONAL = /(?:^|[^a-z])(email|e-mail|phone|telephone|mobile|ssn|social security|home address|street address|date of birth|birth date|personal information|personally identifiable)(?:[^a-z]|$)/i;
const MAX_TEXT = 4096;
const MAX_LIST = 32;

function asText(value: unknown, field: string, max = MAX_TEXT): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0") || value.length > max || SECRET.test(value)) throw new InvalidOrganizationalKnowledgeError(`${field} must be bounded and free of secret-like material`);
}
function asUuid(value: unknown, field: string): asserts value is string {
  asText(value, field, 64);
  if (!UUID.test(value)) throw new InvalidOrganizationalKnowledgeError(`${field} must be a durable UUID`);
}
function asId(value: unknown, field: string): asserts value is string {
  asText(value, field, 256);
  if (!SAFE_ID.test(value)) throw new InvalidOrganizationalKnowledgeError(`${field} has invalid characters`);
}
function list(value: unknown, field: string, minimum: number): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_LIST || value.some((item) => typeof item !== "string" || item.trim() === "" || item.length > 256 || SECRET.test(item))) throw new InvalidOrganizationalKnowledgeError(`${field} must be a bounded list`);
  if (new Set(value.map((item) => item.toLowerCase())).size !== value.length) throw new InvalidOrganizationalKnowledgeError(`${field} must not contain duplicates`);
}
function score(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new InvalidOrganizationalKnowledgeError(`${field} must be in [0,1]`);
}
function copy<T extends OrganizationalKnowledge>(value: T): T {
  return Object.freeze({ ...value, sourceEvidenceIds: Object.freeze([...value.sourceEvidenceIds]), sourceDigestIds: Object.freeze([...value.sourceDigestIds]), episodeIds: Object.freeze([...value.episodeIds]) });
}
function assertProposal(value: OrganizationalKnowledgeProposal): void {
  if (!value || value.schemaVersion !== ORGANIZATIONAL_KNOWLEDGE_SCHEMA_VERSION) throw new InvalidOrganizationalKnowledgeError("organizational knowledge schema version is unsupported");
  asUuid(value.projectId, "projectId"); asUuid(value.sourceGoalId, "sourceGoalId"); asId(value.departmentId, "departmentId");
  asText(value.statement, "statement"); asText(value.rationale, "rationale");
  if (PERSONAL.test(value.statement) || PERSONAL.test(value.rationale)) throw new InvalidOrganizationalKnowledgeError("organizational knowledge cannot contain personal information");
  list(value.sourceEvidenceIds, "sourceEvidenceIds", 0); list(value.sourceDigestIds, "sourceDigestIds", 0); list(value.episodeIds, "episodeIds", 1);
  if (value.sourceEvidenceIds.length === 0 && value.sourceDigestIds.length === 0) throw new InvalidOrganizationalKnowledgeError("organizational knowledge requires source evidence");
  score(value.confidence, "confidence"); score(value.freshness, "freshness");
  if (typeof value.generalized !== "boolean") throw new InvalidOrganizationalKnowledgeError("generalized must be boolean");
}
export function assertValidOrganizationalKnowledgeProposal(value: unknown): asserts value is OrganizationalKnowledgeProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidOrganizationalKnowledgeError("organizational knowledge proposal must be an object");
  assertProposal(value as OrganizationalKnowledgeProposal);
}

export function createWorkerProposedKnowledge(input: OrganizationalKnowledgeProposal): OrganizationalKnowledge {
  assertValidOrganizationalKnowledgeProposal(input);
  const now = new Date().toISOString();
  return copy({ ...input, knowledgeId: randomUUID(), revision: 1, scope: "worker_proposed", status: "proposed", projectId: input.projectId.toLowerCase(), sourceProjectId: input.projectId.toLowerCase(),
    sourceEvidenceIds: Object.freeze(input.sourceEvidenceIds.map((id) => id.toLowerCase())), sourceDigestIds: Object.freeze(input.sourceDigestIds.map((id) => id.toLowerCase())),
    councilRoundId: null, reason: null, createdAt: now });
}

export function promoteKnowledgeToProject(lesson: OrganizationalKnowledge, promotion: DepartmentHeadPromotion): OrganizationalKnowledge {
  if (lesson.scope !== "worker_proposed" || lesson.status !== "proposed") throw new InvalidOrganizationalKnowledgeError("only a worker-proposed lesson can be promoted");
  if (promotion.promoterRoleKind !== "department_head") throw new InvalidOrganizationalKnowledgeError("only a Department Head may promote organizational knowledge");
  if (promotion.promoterDepartmentId !== lesson.departmentId) throw new InvalidOrganizationalKnowledgeError("Department Head department does not match lesson");
  return copy({ ...lesson, revision: lesson.revision + 1, scope: "project_department", status: "active", createdAt: new Date().toISOString() });
}

function assertGeneralizedSafe(lesson: OrganizationalKnowledge, promotion: GlobalKnowledgePromotion): void {
  asText(promotion.generalizedStatement, "generalizedStatement");
  asId(promotion.curatorRoleId, "curatorRoleId");
  if (PERSONAL.test(promotion.generalizedStatement) || SECRET.test(promotion.generalizedStatement) || (RAW_PROJECT.test(promotion.generalizedStatement) || promotion.generalizedStatement.toLowerCase().includes(lesson.sourceProjectId.toLowerCase())) || promotion.generalizedStatement.toLowerCase().includes(lesson.sourceGoalId.toLowerCase())) throw new InvalidOrganizationalKnowledgeError("global knowledge contains raw project content or personal information");
  if (PERSONAL.test(lesson.statement) || PERSONAL.test(lesson.rationale) || SECRET.test(lesson.statement) || SECRET.test(lesson.rationale)) throw new InvalidOrganizationalKnowledgeError("global knowledge contains unsafe source content");
  if (!promotion.encoreCouncilApproved) throw new InvalidOrganizationalKnowledgeError("Encore Council approval is required for global knowledge");
  if (!Array.isArray(promotion.corroboratingSourceIds) || !Array.isArray(promotion.corroboratingEpisodeIds) || promotion.corroboratingSourceIds.length < 2 || promotion.corroboratingSourceIds.length !== promotion.corroboratingEpisodeIds.length || new Set(promotion.corroboratingSourceIds.map((id) => id.toLowerCase())).size !== promotion.corroboratingSourceIds.length || new Set(promotion.corroboratingEpisodeIds.map((id) => id.toLowerCase())).size !== promotion.corroboratingEpisodeIds.length || promotion.corroboratingSourceIds.some((id, index) => !UUID.test(id) || lesson.sourceDigestIds[index]?.toLowerCase() !== id.toLowerCase() || lesson.episodeIds[index]?.toLowerCase() !== promotion.corroboratingEpisodeIds[index]!.toLowerCase())) throw new InvalidOrganizationalKnowledgeError("global knowledge requires distinct source-bound corroboration across episodes");
}
export function promoteKnowledgeToGlobal(lesson: OrganizationalKnowledge, promotion: GlobalKnowledgePromotion): OrganizationalKnowledge {
  if (lesson.scope === "global") return lesson;
  if (lesson.scope !== "project_department") throw new InvalidOrganizationalKnowledgeError("only Department Head project knowledge may be promoted globally");
  if (lesson.status !== "active") throw new InvalidOrganizationalKnowledgeError("only active project knowledge may be promoted globally");
  if (lesson.generalized !== true) throw new InvalidOrganizationalKnowledgeError("only generalized project knowledge may be promoted globally");
  assertGeneralizedSafe(lesson, promotion);
  return copy({ ...lesson, revision: lesson.revision + 1, scope: "global", status: "active", projectId: null, generalized: true, statement: promotion.generalizedStatement, rationale: "Generalized organizational guidance.", generalizedStatement: promotion.generalizedStatement, curatorRoleId: promotion.curatorRoleId, ...(promotion.curatorOperatorId === undefined ? {} : { curatorOperatorId: promotion.curatorOperatorId }), ...(promotion.curatorDepartmentId === undefined ? {} : { curatorDepartmentId: promotion.curatorDepartmentId }), sourceEvidenceIds: Object.freeze([]), episodeIds: Object.freeze([...promotion.corroboratingEpisodeIds]), councilRoundId: promotion.councilRoundId ?? null, createdAt: new Date().toISOString() });
}

export function decayOrganizationalKnowledge(lesson: OrganizationalKnowledge, options: KnowledgeDecayOptions): OrganizationalKnowledge {
  const now = Date.parse(options.now); const supported = Date.parse(options.lastSupportedAt);
  if (!Number.isFinite(now) || !Number.isFinite(supported)) throw new InvalidOrganizationalKnowledgeError("knowledge decay timestamps must be valid ISO dates");
  const staleAfterMs = options.staleAfterMs ?? 30 * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1) throw new InvalidOrganizationalKnowledgeError("staleAfterMs must be a positive bounded integer");
  const stale = now - supported >= staleAfterMs;
  if (!stale && !options.contradicted) return lesson;
  return copy({ ...lesson, revision: lesson.revision + 1, status: options.contradicted ? "contradicted" : lesson.status, confidence: lesson.confidence * 0.9, freshness: lesson.freshness * 0.5, createdAt: new Date(now).toISOString(), reason: options.contradicted ? "Contradicted evidence awaits adjudication." : "Confidence and freshness decayed because supporting evidence is stale." });
}

export function retireOrganizationalKnowledge(lesson: OrganizationalKnowledge, retirement: { readonly status: "retired" | "unsupported"; readonly reason: string }): OrganizationalKnowledge {
  asText(retirement.reason, "retirement.reason", 1024);
  if (retirement.status !== "retired" && retirement.status !== "unsupported") throw new InvalidOrganizationalKnowledgeError("retirement status is invalid");
  if (lesson.status === "retired") throw new InvalidOrganizationalKnowledgeError("lesson is already retired");
  return copy({ ...lesson, revision: lesson.revision + 1, status: retirement.status, reason: retirement.reason, createdAt: new Date().toISOString() });
}
