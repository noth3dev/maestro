import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";

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
