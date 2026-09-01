import { createHash } from "node:crypto";

export const TASK_CONTRACT_SCHEMA_VERSION = 1;
export const OVERTURE_ROLE_TAXONOMY_VERSION = 2;

/** Canonical selectively activated Overture candidate pool from phase2.md. */
export const OVERTURE_ROLE_IDS = [
  "conversation-lead",
  "architecture-analyst",
  "external-research-scout",
  "security-evaluator",
  "design-mock-specialist",
  "task-editor",
] as const;
export type OvertureRoleId = typeof OVERTURE_ROLE_IDS[number];

/** IDs written by the first Task Contract implementation, retained for migration. */
const LEGACY_OVERTURE_ROLE_ALIASES: Readonly<Record<string, OvertureRoleId>> = Object.freeze({
  "project-context-scout": "architecture-analyst",
  "requirements-analyst": "conversation-lead",
});

export type TaskContractLaunchState = "awaiting_confirmation" | "launched";

export interface TaskContractSubstance {
  readonly desiredOutcome: string;
  readonly userVisibleBehavior: readonly string[];
  readonly successCriteria: readonly string[];
  readonly liveEvidence: readonly string[];
  readonly scope: readonly string[];
  readonly nonGoals: readonly string[];
  readonly priorities: readonly string[];
  readonly acceptableTradeoffs: readonly string[];
  readonly constraints: readonly string[];
  readonly knownEdgeCases: readonly string[];
  readonly project: { readonly projectId: string; readonly repository: string; readonly immutableBaseRevision: string; readonly dataBoundary: string };
  readonly evidenceReferences: readonly string[];
  readonly approvedPreviewReferences: readonly string[];
  readonly expectedGroups: readonly string[];
  readonly expectedDepartments: readonly string[];
  readonly criticalActionExpectations: readonly string[];
  readonly forbiddenEffects: readonly string[];
  readonly environmentAssumptions: readonly string[];
  readonly externalServiceAssumptions: readonly string[];
  readonly budget: { readonly ceiling: string; readonly reportingExpectations: readonly string[]; readonly stoppingConditions: readonly string[] };
}

export interface TaskContract extends TaskContractSubstance {
  readonly contractId: string;
  readonly schemaVersion: typeof TASK_CONTRACT_SCHEMA_VERSION;
  readonly version: number;
  readonly decisionHistory: readonly TaskContractDecision[];
  readonly contentHash: string;
  readonly launchState: TaskContractLaunchState;
}

export interface TaskContractDecision {
  readonly decisionId: string;
  readonly kind: "created" | "amended" | "overture_selected";
  readonly evidence: Record<string, unknown>;
}

export class InvalidTaskContractError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidTaskContractError"; }
}

export interface OvertureSelectionInput {
  readonly outsideEvidenceRequested: boolean;
  readonly previewNeeded: boolean;
}

/**
 * Map stored IDs from the first taxonomy to the canonical pool. Legacy
 * selections did not include Security Evaluator, so migration adds that
 * mandatory boundary role whenever a legacy ID is present.
 */
export function canonicalizeOvertureRoles(value: readonly unknown[]): readonly OvertureRoleId[] {
  if (!Array.isArray(value)) throw new InvalidTaskContractError("Overture roles must be a list");
  const selected = new Set<OvertureRoleId>();
  let containsLegacyRole = false;
  for (const role of value) {
    if (typeof role !== "string") throw new InvalidTaskContractError("Overture role must be a string");
    if ((OVERTURE_ROLE_IDS as readonly string[]).includes(role)) {
      selected.add(role as OvertureRoleId);
    } else if (Object.hasOwn(LEGACY_OVERTURE_ROLE_ALIASES, role)) {
      selected.add(LEGACY_OVERTURE_ROLE_ALIASES[role]!);
      containsLegacyRole = true;
    } else {
      throw new InvalidTaskContractError(`unknown Overture role: ${role}`);
    }
  }
  if (containsLegacyRole) selected.add("security-evaluator");
  return OVERTURE_ROLE_IDS.filter((role) => selected.has(role));
}

/** A deterministic, transparent selection: the canonical intake boundary roles always frame intake. */
export function selectOvertureRoles(input: OvertureSelectionInput): readonly OvertureRoleId[] {
  return [
    "conversation-lead",
    "architecture-analyst",
    ...(input.outsideEvidenceRequested ? ["external-research-scout"] as const : []),
    "security-evaluator",
    ...(input.previewNeeded ? ["design-mock-specialist"] as const : []),
    "task-editor",
  ];
}

/** Stable JSON encoding for cross-process SHA-256 identity. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function assertValidTaskContractSubstance(value: unknown): asserts value is TaskContractSubstance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidTaskContractError("Task Contract substance must be an object");
  const record = value as Record<string, unknown>;
  const textFields = ["desiredOutcome"];
  const listFields = ["userVisibleBehavior", "successCriteria", "liveEvidence", "scope", "nonGoals", "priorities", "acceptableTradeoffs", "constraints", "knownEdgeCases", "evidenceReferences", "approvedPreviewReferences", "expectedGroups", "expectedDepartments", "criticalActionExpectations", "forbiddenEffects", "environmentAssumptions", "externalServiceAssumptions"];
  for (const field of textFields) if (typeof record[field] !== "string" || record[field].trim() === "") throw new InvalidTaskContractError(`Task Contract ${field} is required`);
  for (const field of listFields) {
    if (!Array.isArray(record[field]) || !record[field].every((item) => typeof item === "string" && item.trim() !== "")) throw new InvalidTaskContractError(`Task Contract ${field} must be a string list`);
  }
  const project = record.project as Record<string, unknown> | null;
  if (!project || typeof project !== "object" || ["projectId", "repository", "immutableBaseRevision", "dataBoundary"].some((field) => typeof project[field] !== "string" || (project[field] as string).trim() === "")) throw new InvalidTaskContractError("Task Contract project boundary is required");
  const budget = record.budget as Record<string, unknown> | null;
  if (!budget || typeof budget !== "object" || typeof budget.ceiling !== "string" || budget.ceiling.trim() === "" || !Array.isArray(budget.reportingExpectations) || !Array.isArray(budget.stoppingConditions) || !budget.reportingExpectations.every((item) => typeof item === "string" && item.trim() !== "") || !budget.stoppingConditions.every((item) => typeof item === "string" && item.trim() !== "")) throw new InvalidTaskContractError("Task Contract budget is required");
}

export function taskContractContentHash(substance: TaskContractSubstance): string {
  return createHash("sha256").update(canonicalJson(substance)).digest("hex");
}

export function createTaskContract(contractId: string, substance: TaskContractSubstance, decisionHistory: readonly TaskContractDecision[] = []): TaskContract {
  return {
    contractId, schemaVersion: TASK_CONTRACT_SCHEMA_VERSION, version: 1, ...substance, decisionHistory,
    contentHash: taskContractContentHash(substance), launchState: "awaiting_confirmation",
  };
}

/** Any substantive edit yields a new identity and must obtain a new exact confirmation. */
export function amendTaskContract(current: TaskContract, substance: TaskContractSubstance, decision: TaskContractDecision): TaskContract {
  return {
    contractId: current.contractId, schemaVersion: TASK_CONTRACT_SCHEMA_VERSION, version: current.version + 1,
    ...substance, decisionHistory: [...current.decisionHistory, decision],
    contentHash: taskContractContentHash(substance), launchState: "awaiting_confirmation",
  };
}
