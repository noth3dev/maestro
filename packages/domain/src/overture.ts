import { OVERTURE_ROLE_BRIEFS, overtureRoleSystemPrompt } from "@maestro/prompts";
import { sha256Hex } from "./hash.js";
import { canonicalJson } from "./task-contract.js";
import type { ModelCapabilityAxis } from "./model-profile.js";
import type { OvertureRoleId } from "./task-contract.js";
import { OVERTURE_ROLE_IDS } from "./task-contract.js";

export { OVERTURE_ROLE_IDS };

export const OVERTURE_RUN_SCHEMA_VERSION = 1 as const;
export const OVERTURE_PLAN_MANIFEST_SCHEMA_VERSION = 1 as const;

export type OvertureRunState = "collecting" | "waiting_for_operator" | "synthesizing" | "review" | "blocked" | "launched" | "cancelled";
export type OverturePlanDocumentKind = "project" | "phase" | "slice";
export const OVERTURE_EXECUTION_PHASE = "overture" as const;

export interface OvertureTaskContractRef {
  readonly planId: string;
  readonly version: number;
  readonly manifestHash: string;
}

export interface OvertureRoleDefinition {
  readonly id: OvertureRoleId;
  readonly displayName: string;
  readonly taskClass: "conversation" | "architecture" | "research" | "security" | "design" | "planning";
  readonly modelCapabilityAxes: readonly ModelCapabilityAxis[];
  readonly allowedTools: readonly string[];
  readonly forbiddenActions: readonly string[];
}

const COMMON_FORBIDDEN_ACTIONS = [
  "create-goal",
  "spawn-worker",
  "create-mission-bundle",
  "modify-repository",
  "approve-critical-action",
  "launch-task-contract",
] as const;

/** Stable role policies. A runtime may choose a provider/model that meets these capabilities. */
export interface OvertureRoleRuntimeContext {
  readonly roleId: OvertureRoleId;
  readonly projectId: string;
  readonly runId: string;
  readonly conversationId: string;
}

export interface OvertureRoleRuntimePolicy {
  readonly roleId: OvertureRoleId;
  readonly taskClass: OvertureRoleDefinition["taskClass"];
  readonly systemPrompt: string;
  readonly modelCapabilityAxes: readonly ModelCapabilityAxis[];
  readonly allowedTools: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly outputTokenBudget: number;
  readonly contextBoundary: { readonly projectId: string; readonly runId: string; readonly conversationId: string };
}

export class InvalidOvertureRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOvertureRoleError";
  }
}

/** The session IPython tool, whose host helpers read and write the conversation's own workspace (never the project repository). */
export const OVERTURE_WORKSPACE_TOOLS = ["ipython"] as const;



export const OVERTURE_ROLE_DEFINITIONS: readonly OvertureRoleDefinition[] = Object.freeze([
  {
    id: "conversation-lead",
    displayName: "Conversation Lead",
    taskClass: "conversation",
    modelCapabilityAxes: ["reasoning", "instruction-fidelity", "knowledge"],
    allowedTools: ["read-conversation", "ask-operator", ...OVERTURE_WORKSPACE_TOOLS],
    forbiddenActions: COMMON_FORBIDDEN_ACTIONS,
  },
  {
    id: "architecture-analyst",
    displayName: "Architecture Analyst",
    taskClass: "architecture",
    modelCapabilityAxes: ["reasoning", "long-context", "coding"],
    allowedTools: ["read-conversation", "read-project", "read-git", ...OVERTURE_WORKSPACE_TOOLS],
    forbiddenActions: COMMON_FORBIDDEN_ACTIONS,
  },
  {
    id: "external-research-scout",
    displayName: "External Research Scout",
    taskClass: "research",
    modelCapabilityAxes: ["knowledge", "long-context", "verification"],
    allowedTools: ["read-conversation", "search-public-sources", ...OVERTURE_WORKSPACE_TOOLS],
    forbiddenActions: COMMON_FORBIDDEN_ACTIONS,
  },
  {
    id: "security-evaluator",
    displayName: "Security Evaluator",
    taskClass: "security",
    modelCapabilityAxes: ["reasoning", "verification", "refusal-calibration"],
    allowedTools: ["read-conversation", "read-project", "record-finding", ...OVERTURE_WORKSPACE_TOOLS],
    forbiddenActions: COMMON_FORBIDDEN_ACTIONS,
  },
  {
    id: "design-mock-specialist",
    displayName: "Design and Mock Specialist",
    taskClass: "design",
    modelCapabilityAxes: ["instruction-fidelity", "knowledge", "long-context"],
    allowedTools: ["read-conversation", "write-design-artifact", ...OVERTURE_WORKSPACE_TOOLS],
    forbiddenActions: COMMON_FORBIDDEN_ACTIONS,
  },
  {
    id: "task-editor",
    displayName: "Task Editor",
    taskClass: "planning",
    modelCapabilityAxes: ["reasoning", "instruction-fidelity", "verification", "long-context"],
    allowedTools: ["read-conversation", "read-overture-artifacts", "write-plan-revision", "write-task-contract-draft", ...OVERTURE_WORKSPACE_TOOLS],
    forbiddenActions: COMMON_FORBIDDEN_ACTIONS,
  },
]);

const ROLE_OUTPUT_BUDGETS: Readonly<Record<OvertureRoleId, number>> = Object.freeze({
  "conversation-lead": 8_192,
  "architecture-analyst": 4_096,
  "external-research-scout": 3_072,
  "security-evaluator": 3_072,
  "design-mock-specialist": 12_288,
  "task-editor": 8_192,
});

export function createOvertureRoleRuntimePolicy(context: OvertureRoleRuntimeContext): OvertureRoleRuntimePolicy {
  const definition = OVERTURE_ROLE_DEFINITIONS.find((role) => role.id === context.roleId);
  if (definition === undefined) throw new InvalidOvertureRoleError(`unknown Overture role: ${context.roleId}`);
  if ([context.projectId, context.runId, context.conversationId].some((value) => typeof value !== "string" || value.trim() === ""))
    throw new InvalidOvertureRoleError("Overture role runtime requires project, run, and conversation boundaries");
  return Object.freeze({
    roleId: definition.id,
    taskClass: definition.taskClass,
    systemPrompt: overtureRoleSystemPrompt({
      displayName: definition.displayName,
      taskClass: definition.taskClass,
      allowedTools: definition.allowedTools,
      forbiddenActions: definition.forbiddenActions,
      usesWorkspace: definition.allowedTools.includes("ipython"),
      ...(OVERTURE_ROLE_BRIEFS[definition.id] === undefined ? {} : { brief: OVERTURE_ROLE_BRIEFS[definition.id] }),
    }),
    modelCapabilityAxes: [...definition.modelCapabilityAxes],
    allowedTools: [...definition.allowedTools],
    forbiddenActions: [...definition.forbiddenActions],
    outputTokenBudget: ROLE_OUTPUT_BUDGETS[definition.id],
    contextBoundary: { projectId: context.projectId, runId: context.runId, conversationId: context.conversationId },
  });
}

export interface OverturePlanDocument {
  readonly documentId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly path: string;
  readonly kind: OverturePlanDocumentKind;
  readonly version: number;
  readonly content: string;
  readonly contentHash: string;
  readonly sourceRefs: readonly string[];
  readonly dependencies: readonly string[];
}

export interface OverturePlanManifestDocument {
  readonly documentId: string;
  readonly path: string;
  readonly kind: OverturePlanDocumentKind;
  readonly version: number;
  readonly contentHash: string;
  readonly sourceRefs: readonly string[];
  readonly dependencies: readonly string[];
}

export interface OverturePlanManifest {
  readonly schemaVersion: typeof OVERTURE_PLAN_MANIFEST_SCHEMA_VERSION;
  readonly projectId: string;
  readonly runId: string;
  readonly documents: readonly OverturePlanManifestDocument[];
  readonly manifestHash: string;
}

export class InvalidOverturePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOverturePlanError";
  }
}

const OVERTURE_SECRET_LIKE =
  /(?:authorization\s*:\s*bearer\s+|bearer\s+|password\s*[:=]|passwd\s*[:=]|secret\s*[:=]|api[_-]?key\s*[:=]|access[_-]?token\s*[:=]|refresh[_-]?token\s*[:=]|credential\s*[:=]|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|(?:^|[^a-z0-9])(?:sk|pk)-[a-z0-9_-]{16,}(?:$|[^a-z0-9])|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|AKIA[0-9A-Z]{16}|gh[pousr]_[a-z0-9]{20,}|AIza[0-9a-z_-]{20,}|xox[baprs]-[0-9a-z-]{20,}|hf_[0-9a-z]{20,})/i;
const OVERTURE_RAW_MODEL_OUTPUT =
  /<\/?(?:thinking|analysis|tool_call|function_call)\b|(?:raw|private)\s+(?:model\s+)?(?:reasoning|chain[- ]of[- ]thought)|tool\s+arguments?\s*[:=]/i;

export function isSafeOvertureText(value: unknown, maxLength = 60_000): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= maxLength &&
    !value.includes("\0") &&
    !OVERTURE_SECRET_LIKE.test(value) &&
    !OVERTURE_RAW_MODEL_OUTPUT.test(value)
  );
}

export function assertSafeOvertureText(value: unknown, field = "content", maxLength = 60_000): asserts value is string {
  if (!isSafeOvertureText(value, maxLength))
    throw new InvalidOverturePlanError(`${field} contains prohibited sensitive or raw model material`);
}

export function overturePlanContentHash(content: string): string {
  assertSafeOvertureText(content, "plan content");
  return sha256Hex(content);
}

export function assertValidOverturePlanPath(path: string, kind: OverturePlanDocumentKind): string {
  if (typeof path !== "string" || path.includes("/") || path.includes("\\") || /[\r\n]/.test(path))
    throw new InvalidOverturePlanError("plan path must be a safe file name");
  if (kind === "slice" && path.endsWith("slice00.md")) throw new InvalidOverturePlanError(`slice number must be positive: ${path}`);
  const matches =
    kind === "project"
      ? path === "plan00.md"
      : kind === "phase"
        ? /^plan(?:0[1-9]|[1-9][0-9]+)\.md$/.test(path)
        : /^plan(?:0[1-9]|[1-9][0-9]+)-slice(?:0[1-9]|[1-9][0-9]+)\.md$/.test(path);
  if (!matches) throw new InvalidOverturePlanError(`plan path does not match kind ${kind}: ${path}`);
  return path;
}

export function buildOverturePlanManifest(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly documents: readonly OverturePlanDocument[];
}): OverturePlanManifest {
  if (input.projectId.trim() === "" || input.runId.trim() === "")
    throw new InvalidOverturePlanError("manifest project and run IDs are required");
  const paths = new Set<string>();
  const ids = new Set<string>();
  const documents = [...input.documents]
    .sort((left, right) => {
      const kindOrder: Record<OverturePlanDocumentKind, number> = { project: 0, phase: 1, slice: 2 };
      return kindOrder[left.kind] - kindOrder[right.kind] || left.path.localeCompare(right.path);
    })
    .map((document) => {
      assertValidOverturePlanPath(document.path, document.kind);
      if (document.projectId !== input.projectId || document.runId !== input.runId)
        throw new InvalidOverturePlanError("plan document project/run boundary mismatch");
      if (paths.has(document.path) || ids.has(document.documentId))
        throw new InvalidOverturePlanError("plan manifest contains duplicate document identity");
      if (document.version < 1 || !Number.isSafeInteger(document.version))
        throw new InvalidOverturePlanError("plan document version must be positive");
      if (overturePlanContentHash(document.content) !== document.contentHash)
        throw new InvalidOverturePlanError(`plan content hash mismatch: ${document.path}`);
      paths.add(document.path);
      ids.add(document.documentId);
      return {
        documentId: document.documentId,
        path: document.path,
        kind: document.kind,
        version: document.version,
        contentHash: document.contentHash,
        sourceRefs: [...document.sourceRefs],
        dependencies: [...document.dependencies],
      };
    });
  if (!documents.some((document) => document.path === "plan00.md" && document.kind === "project"))
    throw new InvalidOverturePlanError("plan manifest requires plan00.md");
  const byPath = new Map(documents.map((document) => [document.path, document]));
  for (const document of documents) {
    for (const dependency of document.dependencies)
      if (!ids.has(dependency)) throw new InvalidOverturePlanError(`unknown plan dependency in ${document.path}: ${dependency}`);
  }
  for (const document of documents.filter((item) => item.kind === "slice")) {
    const phasePath = document.path.replace(/-slice(?:0[1-9]|[1-9][0-9]+)\.md$/, ".md");
    const phase = byPath.get(phasePath);
    if (phase === undefined || !document.dependencies.includes(phase.documentId))
      throw new InvalidOverturePlanError(`slice ${document.path} must depend on ${phasePath}`);
  }
  const unsigned = {
    schemaVersion: OVERTURE_PLAN_MANIFEST_SCHEMA_VERSION,
    projectId: input.projectId,
    runId: input.runId,
    documents,
  } as const;
  return { ...unsigned, manifestHash: sha256Hex(canonicalJson(unsigned)) };
}
