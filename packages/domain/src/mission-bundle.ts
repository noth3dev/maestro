import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";
import { PERSONA_AXES, parsePersonaProfile, type PersonaAxis, type PersonaProfile } from "./persona.js";

export class InvalidMissionBundleError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidMissionBundleError"; }
}

export type MissionRole = "head" | "scout" | "execution";

/** Every field is an explicit, least-privilege grant. Installed capability is not automatically assigned capability. */
export interface MissionBundleSubstance {
  readonly role: MissionRole;
  readonly profileRef: string;
  readonly goalBrief: string;
  readonly approvedModels: readonly string[];
  readonly allowedSkills: readonly string[];
  readonly allowedTools: readonly string[];
  readonly allowedPaths: readonly string[];
  readonly environment: readonly string[];
  readonly authorityBoundary: readonly string[];
  readonly externalServiceBoundary: readonly string[];
  readonly dataBoundary: readonly string[];
  readonly costCeiling: string;
  readonly timeCeiling: string;
  readonly retryCeiling: number;
  readonly workerCeiling: number;
  readonly deliverable: string;
  readonly evidenceRequirements: readonly string[];
  readonly validationCriteria: readonly string[];
  readonly terminationConditions: readonly string[];
}

/** Every identity/binding field is derived from the active Department Plan item; never caller-supplied. */
export interface MissionBundle {
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly planContentHash: string;
  readonly itemId: string;
  readonly parentRef: string;
  readonly substance: MissionBundleSubstance;
  readonly contentHash: string;
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidMissionBundleError(`${field} is required`);
}
function texts(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) throw new InvalidMissionBundleError(`${field} must be a string list`);
}
function nonnegativeInt(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new InvalidMissionBundleError(`${field} must be a nonnegative safe integer`);
}
function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidMissionBundleError(`${name} must be an object`);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new InvalidMissionBundleError(`${name} has unknown field ${key}`);
}

export function assertValidMissionBundleSubstance(value: unknown): asserts value is MissionBundleSubstance {
  object(value, "Mission bundle substance");
  const fields = ["role", "profileRef", "goalBrief", "approvedModels", "allowedSkills", "allowedTools", "allowedPaths", "environment", "authorityBoundary", "externalServiceBoundary", "dataBoundary", "costCeiling", "timeCeiling", "retryCeiling", "workerCeiling", "deliverable", "evidenceRequirements", "validationCriteria", "terminationConditions"] as const;
  onlyKeys(value, fields, "Mission bundle substance");
  if (value.role !== "head" && value.role !== "scout" && value.role !== "execution") throw new InvalidMissionBundleError("Mission bundle role must be head, scout, or execution");
  text(value.profileRef, "Mission bundle profileRef");
  text(value.goalBrief, "Mission bundle goalBrief");
  texts(value.approvedModels, "Mission bundle approvedModels");
  if ((value.approvedModels as readonly string[]).length === 0) throw new InvalidMissionBundleError("Mission bundle requires at least one approved model");
  texts(value.allowedSkills, "Mission bundle allowedSkills");
  texts(value.allowedTools, "Mission bundle allowedTools");
  texts(value.allowedPaths, "Mission bundle allowedPaths");
  texts(value.environment, "Mission bundle environment");
  texts(value.authorityBoundary, "Mission bundle authorityBoundary");
  texts(value.externalServiceBoundary, "Mission bundle externalServiceBoundary");
  texts(value.dataBoundary, "Mission bundle dataBoundary");
  text(value.costCeiling, "Mission bundle costCeiling");
  text(value.timeCeiling, "Mission bundle timeCeiling");
  nonnegativeInt(value.retryCeiling, "Mission bundle retryCeiling");
  nonnegativeInt(value.workerCeiling, "Mission bundle workerCeiling");
  if (value.role !== "head" && value.workerCeiling !== 0) throw new InvalidMissionBundleError("Only a Head bundle may carry a nonzero workerCeiling");
  text(value.deliverable, "Mission bundle deliverable");
  texts(value.evidenceRequirements, "Mission bundle evidenceRequirements");
  texts(value.validationCriteria, "Mission bundle validationCriteria");
  if ((value.validationCriteria as readonly string[]).length === 0) throw new InvalidMissionBundleError("Mission bundle requires at least one validation criterion");
  texts(value.terminationConditions, "Mission bundle terminationConditions");
  if ((value.terminationConditions as readonly string[]).length === 0) throw new InvalidMissionBundleError("Mission bundle requires at least one termination condition");
}

export function missionBundleSubstanceContentHash(substance: MissionBundleSubstance): string {
  return createHash("sha256").update(canonicalJson(substance)).digest("hex");
}


/**
 * Mission persona overlay -- plan/phase2.md "Ten-axis persona baseline":
 * "Temporary workers receive a mission profile derived from Department
 * style, Head choice, task ambiguity, risk, collaboration demand, and
 * evidence burden. Worker overlays expire with the mission."
 *
 * The plan does not specify an exact blending formula, nor how "Department
 * style" and "Head choice" are represented in this codebase's data model.
 * This is the most literal reading available: both are treated as full
 * ten-axis PersonaProfile inputs (Department style = the Department's own
 * persona baseline, Head choice = the activated Head's persona), averaged
 * as the base profile, then nudged per-axis by the four scalar [0,1]
 * factors. Every axis is explicitly clamped into [0,1] before being
 * re-validated by parsePersonaProfile -- this is the property Phase 2
 * Tests #11 requires ("Mission persona values remain in [0,1]").
 */
export interface MissionPersonaOverlayInputs {
  readonly departmentStyle: PersonaProfile;
  readonly headChoice: PersonaProfile;
  readonly taskAmbiguity: number;
  readonly risk: number;
  readonly collaborationDemand: number;
  readonly evidenceBurden: number;
}

function unitScalar(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidMissionBundleError(`${field} must be a finite number in [0,1]`);
  }
}

function personaProfileField(value: unknown, field: string): PersonaProfile {
  try {
    return parsePersonaProfile(value);
  } catch {
    throw new InvalidMissionBundleError(`${field} must be a valid ten-axis persona profile`);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function assertValidMissionPersonaOverlayInputs(value: unknown): asserts value is MissionPersonaOverlayInputs {
  object(value, "Mission persona overlay inputs");
  onlyKeys(value, ["departmentStyle", "headChoice", "taskAmbiguity", "risk", "collaborationDemand", "evidenceBurden"], "Mission persona overlay inputs");
  personaProfileField(value.departmentStyle, "Mission persona overlay departmentStyle");
  personaProfileField(value.headChoice, "Mission persona overlay headChoice");
  unitScalar(value.taskAmbiguity, "Mission persona overlay taskAmbiguity");
  unitScalar(value.risk, "Mission persona overlay risk");
  unitScalar(value.collaborationDemand, "Mission persona overlay collaborationDemand");
  unitScalar(value.evidenceBurden, "Mission persona overlay evidenceBurden");
}

/** Derives a mission persona overlay. Every returned axis is guaranteed within [0,1]. */
export function deriveMissionPersonaOverlay(inputs: MissionPersonaOverlayInputs): PersonaProfile {
  assertValidMissionPersonaOverlayInputs(inputs);
  const { departmentStyle, headChoice, taskAmbiguity, risk, collaborationDemand, evidenceBurden } = inputs;
  const base: Record<PersonaAxis, number> = Object.fromEntries(
    PERSONA_AXES.map((axis) => [axis, (departmentStyle[axis] + headChoice[axis]) / 2]),
  ) as Record<PersonaAxis, number>;

  // Task ambiguity favors more exploratory, self-directed conduct.
  base.imagination = clamp01(base.imagination + (taskAmbiguity - 0.5) * 0.3);
  base.initiative = clamp01(base.initiative + (taskAmbiguity - 0.5) * 0.2);
  // Risk favors more careful, evidence-grounded conduct.
  base.caution = clamp01(base.caution + (risk - 0.5) * 0.4);
  base.realism = clamp01(base.realism + (risk - 0.5) * 0.2);
  // Evidence burden favors more rigorous, grounded conduct.
  base.conscientiousness = clamp01(base.conscientiousness + (evidenceBurden - 0.5) * 0.3);
  base.realism = clamp01(base.realism + (evidenceBurden - 0.5) * 0.2);
  // Collaboration demand favors more social, other-attentive conduct.
  base.extraversion = clamp01(base.extraversion + (collaborationDemand - 0.5) * 0.3);
  base.empathy = clamp01(base.empathy + (collaborationDemand - 0.5) * 0.2);
  base.sociability = clamp01(base.sociability + (collaborationDemand - 0.5) * 0.3);
  base.adaptability = clamp01(base.adaptability);
  base.agreeableness = clamp01(base.agreeableness);

  return parsePersonaProfile(base);
}

/**
 * A durable persona overlay bound to one Mission Bundle (identified the same
 * way as MissionBundle itself), with an explicit mission-lifetime expiry.
 * `expiresAt` is the mission-lifetime bound set when the overlay is issued.
 */
export interface MissionPersonaOverlay {
  readonly councilId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly itemId: string;
  readonly persona: PersonaProfile;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** Validate a complete overlay before it crosses a persistence or execution boundary. */
export function assertValidMissionPersonaOverlay(value: unknown): asserts value is MissionPersonaOverlay {
  object(value, "Mission persona overlay");
  onlyKeys(value, ["councilId", "departmentId", "planVersion", "itemId", "persona", "issuedAt", "expiresAt"], "Mission persona overlay");
  text(value.councilId, "Mission persona overlay councilId");
  text(value.departmentId, "Mission persona overlay departmentId");
  if (typeof value.planVersion !== "number" || !Number.isSafeInteger(value.planVersion) || value.planVersion < 1) {
    throw new InvalidMissionBundleError("Mission persona overlay planVersion must be a positive safe integer");
  }
  text(value.itemId, "Mission persona overlay itemId");
  personaProfileField(value.persona, "Mission persona overlay persona");
  const issuedAt = Date.parse(String(value.issuedAt));
  const expiresAt = Date.parse(String(value.expiresAt));
  if (typeof value.issuedAt !== "string" || !Number.isFinite(issuedAt)) {
    throw new InvalidMissionBundleError("Mission persona overlay issuedAt must be a valid timestamp");
  }
  if (typeof value.expiresAt !== "string" || !Number.isFinite(expiresAt)) {
    throw new InvalidMissionBundleError("Mission persona overlay expiresAt must be a valid timestamp");
  }
  if (expiresAt <= issuedAt) {
    throw new InvalidMissionBundleError("Mission persona overlay expiresAt must be after issuedAt");
  }
}

/** True once `now` reaches or passes the overlay's explicit mission-lifetime expiry. */
export function isMissionPersonaOverlayExpired(overlay: Pick<MissionPersonaOverlay, "expiresAt">, now: Date): boolean {
  const expiresAt = Date.parse(overlay.expiresAt);
  const nowAt = now instanceof Date ? now.getTime() : Number.NaN;
  // Invalid persisted timestamps and invalid clocks are unavailable, never active.
  return !Number.isFinite(expiresAt) || !Number.isFinite(nowAt) || nowAt >= expiresAt;
}
