import { z } from "zod";
import { SANE_PERSONA_BASELINE, parsePersonaProfile, type PersonaProfile } from "./persona.js";

export type DepartmentStatus = "sleeping";
export type PermanentRoleStatus = "standing";

export const PERMANENT_ROLE_KINDS = Object.freeze([
  "sane",
  "department_head",
  "sentinel",
  "encore_council",
] as const);
export const PermanentRoleKindSchema = z.enum(PERMANENT_ROLE_KINDS);
export type PermanentRoleKind = (typeof PERMANENT_ROLE_KINDS)[number];

/** The capability boundary is descriptive metadata, not an authority grant. */
export interface RoleCapabilityBoundary {
  readonly allowed: readonly string[];
  readonly forbidden: readonly string[];
}

export const roleCapabilityBoundarySchema = z.object({
  allowed: z.array(z.string().min(1)),
  forbidden: z.array(z.string().min(1)),
}).strict();

export function parseRoleCapabilityBoundary(value: unknown): RoleCapabilityBoundary {
  return roleCapabilityBoundarySchema.parse(value);
}

/** Provenance identifies the approved design source for a durable role identity. */
export interface RoleProvenance {
  readonly source: string;
  readonly sourceRevision: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly reviewVersion: string;
}

export const roleProvenanceSchema = z.object({
  source: z.string().min(1),
  sourceRevision: z.string().min(1),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().min(1),
  reviewVersion: z.string().min(1),
}).strict();

export function parseRoleProvenance(value: unknown): RoleProvenance {
  return roleProvenanceSchema.parse(value);
}

export const PHASE2_ROLE_REVIEW_VERSION = "phase2-role-baselines-v1";

/** A permanent container. Groups never have agents or Goal sessions. */
export interface PermanentGroup {
  readonly groupId: string;
  readonly displayName: string;
}

/** Durable department identity. Session and Goal context are intentionally absent while sleeping. */
export interface PermanentDepartment {
  readonly departmentId: string;
  readonly groupId: string;
  readonly displayName: string;
  readonly status: DepartmentStatus;
  readonly activeSessionId: null;
  readonly goalContext: null;
}

/** Durable role identity. Sessions and Goal context are introduced only by later work. */
export interface PermanentRole {
  readonly roleId: string;
  readonly displayName: string;
  readonly roleKind: PermanentRoleKind;
  readonly status: PermanentRoleStatus;
  /** The mapping is immutable for a permanent role; non-head roles are organization-wide. */
  readonly departmentId: string | null;
  readonly charter: string;
  readonly capabilityBoundary: RoleCapabilityBoundary;
  readonly provenance: RoleProvenance;
  readonly persona: PersonaProfile;
  readonly activeSessionId: null;
  readonly goalContext: null;
}

export const PERMANENT_GROUPS: readonly PermanentGroup[] = Object.freeze([
  { groupId: "product", displayName: "Product Group" },
  { groupId: "tech", displayName: "Tech Group" },
  { groupId: "intelligence", displayName: "Intelligence Group" },
  { groupId: "assurance", displayName: "Assurance Group" },
  { groupId: "operations", displayName: "Operations Group" },
]);

export const PERMANENT_DEPARTMENTS: readonly PermanentDepartment[] = Object.freeze([
  { departmentId: "product", groupId: "product", displayName: "Product Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "design", groupId: "product", displayName: "Design Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "engineering", groupId: "tech", displayName: "Engineering Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "security", groupId: "tech", displayName: "Security Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "infrastructure", groupId: "tech", displayName: "Infrastructure Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "research", groupId: "intelligence", displayName: "Research Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "data-analysis", groupId: "intelligence", displayName: "Data & Analysis Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "quality", groupId: "assurance", displayName: "Quality Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "safety-compliance", groupId: "assurance", displayName: "Safety & Compliance Department", status: "sleeping", activeSessionId: null, goalContext: null },
  { departmentId: "operations", groupId: "operations", displayName: "Operations Department", status: "sleeping", activeSessionId: null, goalContext: null },
]);

const REVIEWED_PROVENANCE: RoleProvenance = Object.freeze({
  source: "plan/phase2.md §25–26",
  sourceRevision: "ac65c8d",
  reviewedBy: "Phase 2 organization review",
  reviewedAt: "2026-09-01",
  reviewVersion: PHASE2_ROLE_REVIEW_VERSION,
});

function reviewedBaseline(values: PersonaProfile): PersonaProfile {
  return Object.freeze({ ...parsePersonaProfile(values) });
}

function capabilityBoundary(allowed: readonly string[], forbidden: readonly string[]): RoleCapabilityBoundary {
  return Object.freeze({
    allowed: Object.freeze([...allowed]),
    forbidden: Object.freeze([...forbidden]),
  });
}

interface RoleDefinition {
  readonly roleId: string;
  readonly displayName: string;
  readonly roleKind: PermanentRoleKind;
  readonly departmentId: string | null;
  readonly charter: string;
  readonly allowedCapabilities: readonly string[];
  readonly forbiddenCapabilities: readonly string[];
  readonly persona: PersonaProfile;
}

function defineRole(definition: RoleDefinition): PermanentRole {
  return Object.freeze({
    roleId: definition.roleId,
    displayName: definition.displayName,
    roleKind: definition.roleKind,
    status: "standing",
    departmentId: definition.departmentId,
    charter: definition.charter,
    capabilityBoundary: capabilityBoundary(definition.allowedCapabilities, definition.forbiddenCapabilities),
    provenance: REVIEWED_PROVENANCE,
    persona: definition.persona,
    activeSessionId: null,
    goalContext: null,
  });
}

const SANE_ALLOWED = [
  "coordinate the Secretary Office",
  "maintain canonical records",
  "present CEO decisions",
] as const;
const SANE_FORBIDDEN = [
  "change CEO intent without confirmation",
  "execute unapproved critical actions",
  "spawn production workers directly",
] as const;

export const SANE_ROLE: PermanentRole = defineRole({
  roleId: "sane",
  displayName: "Sane",
  roleKind: "sane",
  departmentId: null,
  charter: "Coordinate the Secretary Office on behalf of the CEO while preserving intent and canonical records.",
  allowedCapabilities: SANE_ALLOWED,
  forbiddenCapabilities: SANE_FORBIDDEN,
  persona: SANE_PERSONA_BASELINE,
});

const HEAD_ALLOWED = [
  "own the Department contribution",
  "prepare bounded plans and delegation requests",
  "report evidence and validation",
] as const;
const HEAD_FORBIDDEN = [
  "change the permanent Department mapping",
  "exceed Goal authority or budget",
  "spawn unbounded workers",
] as const;

const DEPARTMENT_HEAD_DEFINITIONS: readonly RoleDefinition[] = [
  {
    roleId: "head-product", displayName: "Product Department Head", roleKind: "department_head", departmentId: "product",
    charter: "Decide what should be built and why, preserving product outcomes, priorities, and explicit non-goals.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.78, extraversion: 0.70, imagination: 0.82, realism: 0.78, conscientiousness: 0.88, caution: 0.70, initiative: 0.80, empathy: 0.84, adaptability: 0.78, sociability: 0.78 }),
  },
  {
    roleId: "head-design", displayName: "Design Department Head", roleKind: "department_head", departmentId: "design",
    charter: "Own user experience and interface design, making intent legible without turning previews into production decisions.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.82, extraversion: 0.72, imagination: 0.92, realism: 0.62, conscientiousness: 0.80, caution: 0.65, initiative: 0.78, empathy: 0.92, adaptability: 0.84, sociability: 0.85 }),
  },
  {
    roleId: "head-engineering", displayName: "Engineering Department Head", roleKind: "department_head", departmentId: "engineering",
    charter: "Own implementation design and delivery while preserving interfaces, tests, isolation, and maintainable source changes.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.60, extraversion: 0.62, imagination: 0.65, realism: 0.92, conscientiousness: 0.95, caution: 0.88, initiative: 0.85, empathy: 0.65, adaptability: 0.80, sociability: 0.58 }),
  },
  {
    roleId: "head-security", displayName: "Security Department Head", roleKind: "department_head", departmentId: "security",
    charter: "Own adversarial review, permissions, secrets, and vulnerability boundaries without weakening delivery safety for convenience.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.48, extraversion: 0.55, imagination: 0.52, realism: 0.94, conscientiousness: 0.96, caution: 0.98, initiative: 0.78, empathy: 0.55, adaptability: 0.72, sociability: 0.45 }),
  },
  {
    roleId: "head-infrastructure", displayName: "Infrastructure Department Head", roleKind: "department_head", departmentId: "infrastructure",
    charter: "Own execution environments, deployment readiness, and performance foundations within approved operational boundaries.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.56, extraversion: 0.58, imagination: 0.52, realism: 0.94, conscientiousness: 0.93, caution: 0.92, initiative: 0.82, empathy: 0.60, adaptability: 0.78, sociability: 0.52 }),
  },
  {
    roleId: "head-research", displayName: "Research Department Head", roleKind: "department_head", departmentId: "research",
    charter: "Own technical investigation and external evidence while separating sourced facts, uncertainty, and recommendations.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.70, extraversion: 0.68, imagination: 0.86, realism: 0.78, conscientiousness: 0.82, caution: 0.70, initiative: 0.74, empathy: 0.72, adaptability: 0.80, sociability: 0.70 }),
  },
  {
    roleId: "head-data-analysis", displayName: "Data & Analysis Department Head", roleKind: "department_head", departmentId: "data-analysis",
    charter: "Own internal measurement and quantitative analysis with reproducible methods, clear assumptions, and bounded interpretation.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.58, extraversion: 0.52, imagination: 0.62, realism: 0.92, conscientiousness: 0.94, caution: 0.86, initiative: 0.72, empathy: 0.56, adaptability: 0.76, sociability: 0.48 }),
  },
  {
    roleId: "head-quality", displayName: "Quality Department Head", roleKind: "department_head", departmentId: "quality",
    charter: "Own independent requirements validation and testing; do not trade acceptance evidence for speed or convenience.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.62, extraversion: 0.56, imagination: 0.55, realism: 0.90, conscientiousness: 0.98, caution: 0.94, initiative: 0.72, empathy: 0.65, adaptability: 0.78, sociability: 0.52 }),
  },
  {
    roleId: "head-safety-compliance", displayName: "Safety & Compliance Department Head", roleKind: "department_head", departmentId: "safety-compliance",
    charter: "Own operating boundaries and critical-risk assessment, preserving required safeguards and escalation paths.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.60, extraversion: 0.55, imagination: 0.48, realism: 0.92, conscientiousness: 0.97, caution: 0.99, initiative: 0.64, empathy: 0.64, adaptability: 0.74, sociability: 0.48 }),
  },
  {
    roleId: "head-operations", displayName: "Operations Department Head", roleKind: "department_head", departmentId: "operations",
    charter: "Own Goal state, cost, incidents, and Git or worktree coordination while keeping operational evidence current.",
    allowedCapabilities: HEAD_ALLOWED, forbiddenCapabilities: HEAD_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.74, extraversion: 0.72, imagination: 0.58, realism: 0.88, conscientiousness: 0.92, caution: 0.86, initiative: 0.86, empathy: 0.75, adaptability: 0.84, sociability: 0.78 }),
  },
];

const SENTINEL_ALLOWED = [
  "observe durable orchestration state",
  "record boundary findings",
  "request a safe pause",
] as const;
const SENTINEL_FORBIDDEN = [
  "choose product direction",
  "spawn production workers",
  "weaken safety or authority boundaries",
] as const;

export const SENTINEL_ROLE: PermanentRole = defineRole({
  roleId: "encore-sentinel",
  displayName: "Encore Sentinel",
  roleKind: "sentinel",
  departmentId: null,
  charter: "Observe orchestration boundaries and surface evidence of risk, drift, or inconsistency without directing product work.",
  allowedCapabilities: SENTINEL_ALLOWED,
  forbiddenCapabilities: SENTINEL_FORBIDDEN,
  persona: reviewedBaseline({ agreeableness: 0.42, extraversion: 0.58, imagination: 0.42, realism: 0.95, conscientiousness: 0.98, caution: 0.99, initiative: 0.72, empathy: 0.62, adaptability: 0.78, sociability: 0.46 }),
});

const COUNCIL_ALLOWED = [
  "independently review evidence",
  "record dissent and confidence",
  "recommend bounded decisions",
] as const;
const COUNCIL_FORBIDDEN = [
  "execute production work",
  "change authority or budget",
  "self-approve a critical action",
] as const;

export const ENCORE_COUNCIL_ROLES: readonly PermanentRole[] = Object.freeze([
  defineRole({
    roleId: "encore-council-1", displayName: "Encore Council — Evidence", roleKind: "encore_council", departmentId: null,
    charter: "Independently review evidence quality and provenance for Encore records.",
    allowedCapabilities: COUNCIL_ALLOWED, forbiddenCapabilities: COUNCIL_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.58, extraversion: 0.62, imagination: 0.55, realism: 0.94, conscientiousness: 0.97, caution: 0.92, initiative: 0.68, empathy: 0.58, adaptability: 0.72, sociability: 0.52 }),
  }),
  defineRole({
    roleId: "encore-council-2", displayName: "Encore Council — Challenge", roleKind: "encore_council", departmentId: null,
    charter: "Independently challenge assumptions, safety boundaries, and unresolved dissent in Encore records.",
    allowedCapabilities: COUNCIL_ALLOWED, forbiddenCapabilities: COUNCIL_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.32, extraversion: 0.58, imagination: 0.68, realism: 0.88, conscientiousness: 0.93, caution: 0.96, initiative: 0.76, empathy: 0.48, adaptability: 0.70, sociability: 0.42 }),
  }),
  defineRole({
    roleId: "encore-council-3", displayName: "Encore Council — Synthesis", roleKind: "encore_council", departmentId: null,
    charter: "Independently compare reviewer findings and document conditions, dissent, and confidence for later adjudication.",
    allowedCapabilities: COUNCIL_ALLOWED, forbiddenCapabilities: COUNCIL_FORBIDDEN,
    persona: reviewedBaseline({ agreeableness: 0.74, extraversion: 0.70, imagination: 0.72, realism: 0.86, conscientiousness: 0.95, caution: 0.88, initiative: 0.72, empathy: 0.76, adaptability: 0.84, sociability: 0.74 }),
  }),
]);

export const PERMANENT_ROLES: readonly PermanentRole[] = Object.freeze([
  SANE_ROLE,
  ...DEPARTMENT_HEAD_DEFINITIONS.map(defineRole),
  SENTINEL_ROLE,
  ...ENCORE_COUNCIL_ROLES,
]);

// Explicit aliases make the stable oversight identities discoverable without adding behavior.
export const ENCORE_SENTINEL_ROLE = SENTINEL_ROLE;
