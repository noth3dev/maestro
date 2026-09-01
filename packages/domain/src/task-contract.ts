import { createHash } from "node:crypto";

export const TASK_CONTRACT_SCHEMA_VERSION = 1;

export const OVERTURE_ROLE_IDS = [
  "project-context-scout",
  "external-research-scout",
  "requirements-analyst",
  "design-mock-specialist",
  "task-editor",
] as const;
export type OvertureRoleId = typeof OVERTURE_ROLE_IDS[number];

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

/** A deterministic, transparent selection: the editor and requirements analyst always frame intake. */
export function selectOvertureRoles(input: OvertureSelectionInput): readonly OvertureRoleId[] {
  return [
    "project-context-scout",
    ...(input.outsideEvidenceRequested ? ["external-research-scout"] as const : []),
    "requirements-analyst",
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
