import { SANE_PERSONA_BASELINE, type PersonaProfile } from "./persona.js";

export type DepartmentStatus = "sleeping";
export type PermanentRoleStatus = "standing";

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

/** Durable role identity. A participation/session model is introduced only by later work. */
export interface PermanentRole {
  readonly roleId: string;
  readonly displayName: string;
  readonly status: PermanentRoleStatus;
  readonly departmentId: null;
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

export const SANE_ROLE: PermanentRole = Object.freeze({
  roleId: "sane",
  displayName: "Sane",
  status: "standing",
  departmentId: null,
  persona: SANE_PERSONA_BASELINE,
  activeSessionId: null,
  goalContext: null,
});
