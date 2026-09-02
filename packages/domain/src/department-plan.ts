import { createHash } from "node:crypto";
import { canonicalJson } from "./task-contract.js";
import type { DecisionPacket } from "./council.js";

export class InvalidDepartmentPlanError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidDepartmentPlanError"; }
}

export type DepartmentPlanItemKind = "scout" | "execution";

export interface DepartmentPlanItem {
  readonly itemId: string;
  readonly kind: DepartmentPlanItemKind;
  readonly objective: string;
  readonly dependsOn: readonly string[];
  readonly scoutQuestion: string;
  readonly workerAssignment: string;
  readonly evidenceReferences: readonly string[];
}

export interface DepartmentPlanSubstance {
  readonly contribution: string;
  readonly nonGoals: readonly string[];
  readonly items: readonly DepartmentPlanItem[];
  readonly requiredHandoffs: readonly string[];
  readonly budgetCeiling: string;
  readonly expectedTime: string;
  readonly maxRetries: number;
  readonly maxWorkers: number;
  readonly gitRepository: string;
  readonly gitBranch: string;
  readonly integrationPath: string;
  readonly risks: readonly string[];
  readonly safePausePoints: readonly string[];
  readonly escalationTriggers: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly validationCriteria: readonly string[];
}

/** Every identity/binding field is derived from the frozen Council/Contract; never caller-supplied. */
export interface DepartmentPlan {
  readonly projectId: string;
  readonly goalId: string;
  readonly councilId: string;
  readonly councilSnapshotHash: string;
  readonly decisionPacketHash: string;
  readonly contractId: string;
  readonly contractVersion: number;
  readonly contractContentHash: string;
  readonly departmentId: string;
  readonly headRoleId: string;
  readonly version: number;
  readonly substance: DepartmentPlanSubstance;
  readonly contentHash: string;
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidDepartmentPlanError(`${field} is required`);
}
function texts(value: unknown, field: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) throw new InvalidDepartmentPlanError(`${field} must be a string list`);
}
function nonnegativeInt(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new InvalidDepartmentPlanError(`${field} must be a nonnegative safe integer`);
}
function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidDepartmentPlanError(`${name} must be an object`);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new InvalidDepartmentPlanError(`${name} has unknown field ${key}`);
}

export function assertValidDepartmentPlanItem(value: unknown): asserts value is DepartmentPlanItem {
  object(value, "Department Plan item");
  const fields = ["itemId", "kind", "objective", "dependsOn", "scoutQuestion", "workerAssignment", "evidenceReferences"] as const;
  onlyKeys(value, fields, "Department Plan item");
  text(value.itemId, "Department Plan item itemId");
  if (value.kind !== "scout" && value.kind !== "execution") throw new InvalidDepartmentPlanError("Department Plan item kind must be scout or execution");
  text(value.objective, "Department Plan item objective");
  texts(value.dependsOn, "Department Plan item dependsOn");
  if (typeof value.scoutQuestion !== "string") throw new InvalidDepartmentPlanError("Department Plan item scoutQuestion must be a string");
  if (typeof value.workerAssignment !== "string") throw new InvalidDepartmentPlanError("Department Plan item workerAssignment must be a string");
  if (value.kind === "scout" && value.scoutQuestion.trim() === "") throw new InvalidDepartmentPlanError("Scout item requires a scoutQuestion");
  if (value.kind === "execution" && value.workerAssignment.trim() === "") throw new InvalidDepartmentPlanError("Execution item requires a workerAssignment");
  texts(value.evidenceReferences, "Department Plan item evidenceReferences");
}

function assertNoDependencyCycles(items: readonly DepartmentPlanItem[]): void {
  const byId = new Map(items.map((item) => [item.itemId, item] as const));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: readonly string[]): void => {
    const item = byId.get(id);
    if (item === undefined) return; // unknown-dependency already reported by caller
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") throw new InvalidDepartmentPlanError(`Department Plan item dependency cycle: ${[...path, id].join(" -> ")}`);
    state.set(id, "visiting");
    for (const dep of item.dependsOn) visit(dep, [...path, id]);
    state.set(id, "done");
  };
  for (const item of items) visit(item.itemId, []);
}

export function assertValidDepartmentPlanSubstance(value: unknown): asserts value is DepartmentPlanSubstance {
  object(value, "Department Plan substance");
  const fields = ["contribution", "nonGoals", "items", "requiredHandoffs", "budgetCeiling", "expectedTime", "maxRetries", "maxWorkers", "gitRepository", "gitBranch", "integrationPath", "risks", "safePausePoints", "escalationTriggers", "evidenceReferences", "validationCriteria"] as const;
  onlyKeys(value, fields, "Department Plan substance");
  text(value.contribution, "Department Plan contribution");
  texts(value.nonGoals, "Department Plan nonGoals");
  if (!Array.isArray(value.items) || value.items.length === 0) throw new InvalidDepartmentPlanError("Department Plan items must be a nonempty list");
  for (const item of value.items) assertValidDepartmentPlanItem(item);
  const items = value.items as readonly DepartmentPlanItem[];
  const seenIds = new Set<string>();
  for (const item of items) {
    if (seenIds.has(item.itemId)) throw new InvalidDepartmentPlanError(`Duplicate Department Plan item id: ${item.itemId}`);
    seenIds.add(item.itemId);
  }
  for (const item of items) for (const dep of item.dependsOn) if (!seenIds.has(dep)) throw new InvalidDepartmentPlanError(`Department Plan item ${item.itemId} depends on unknown item: ${dep}`);
  assertNoDependencyCycles(items);
  texts(value.requiredHandoffs, "Department Plan requiredHandoffs");
  text(value.budgetCeiling, "Department Plan budgetCeiling");
  text(value.expectedTime, "Department Plan expectedTime");
  nonnegativeInt(value.maxRetries, "Department Plan maxRetries");
  nonnegativeInt(value.maxWorkers, "Department Plan maxWorkers");
  text(value.gitRepository, "Department Plan gitRepository");
  text(value.gitBranch, "Department Plan gitBranch");
  text(value.integrationPath, "Department Plan integrationPath");
  texts(value.risks, "Department Plan risks");
  texts(value.safePausePoints, "Department Plan safePausePoints");
  texts(value.escalationTriggers, "Department Plan escalationTriggers");
  texts(value.evidenceReferences, "Department Plan evidenceReferences");
  texts(value.validationCriteria, "Department Plan validationCriteria");
}

export function departmentPlanSubstanceContentHash(substance: DepartmentPlanSubstance): string {
  return createHash("sha256").update(canonicalJson(substance)).digest("hex");
}

export function decisionPacketContentHash(packet: DecisionPacket): string {
  return createHash("sha256").update(canonicalJson(packet)).digest("hex");
}
