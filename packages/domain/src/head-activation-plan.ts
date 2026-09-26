import { sha256Hex } from "./hash.js";

export const HEAD_ACTIVATION_PLAN_VERSION = 1 as const;

export interface HeadActivationBriefInput {
  readonly departmentId: string;
  readonly requestedContribution: string;
  readonly urgency: string;
  readonly contextScope: readonly string[];
  readonly budgetEffect: string;
  readonly reason: string;
}

export interface HeadActivationPlanInput {
  readonly version: typeof HEAD_ACTIVATION_PLAN_VERSION;
  readonly departments: readonly HeadActivationBriefInput[];
}

export interface HeadActivationPlan extends HeadActivationPlanInput {
  readonly contentHash: string;
}

/** A stable UUID-shaped command identity derived from any text (idempotent sub-steps). */
export function deriveStableCommandId(input: string): string {
  const hex = sha256Hex(input).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x03) | 0x08).toString(16);
  const id = hex.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/** Stable UUID-shaped command identity for creating the Goal's Head Council. */
export function deriveCouncilCreationCommandId(startCommandId: string, goalId: string): string {
  if (startCommandId.trim() === "" || goalId.trim() === "")
    throw new InvalidHeadActivationPlanError("Council command identity is required");
  return deriveStableCommandId(`maestro:start_goal:council:${startCommandId}:${goalId}`);
}

/** Stable UUID-shaped command identity for one explicit department brief. */
export function deriveHeadActivationCommandId(startCommandId: string, departmentId: string): string {
  if (startCommandId.trim() === "" || departmentId.trim() === "")
    throw new InvalidHeadActivationPlanError("Head activation command identity is required");
  return deriveStableCommandId(`maestro:start_goal:head:${startCommandId}:${departmentId}`);
}

export class InvalidHeadActivationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHeadActivationPlanError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function hashInput(input: HeadActivationPlanInput): string {
  return sha256Hex(canonicalJson(input));
}

export function headActivationPlanContentHash(input: HeadActivationPlanInput | HeadActivationPlan): string {
  const record = input as HeadActivationPlan & { contentHash?: string };
  const { contentHash: _contentHash, ...withoutHash } = record;
  return hashInput(withoutHash);
}

export function createHeadActivationPlan(input: HeadActivationPlanInput): HeadActivationPlan {
  assertValidHeadActivationPlanInput(input);
  return { ...input, contentHash: hashInput(input) };
}

export function assertValidHeadActivationPlan(value: unknown): asserts value is HeadActivationPlan {
  if (!isObject(value)) throw new InvalidHeadActivationPlanError("Head activation plan must be an object");
  assertValidHeadActivationPlanInput(value);
  const plan = value as unknown as HeadActivationPlan;
  if (Object.keys(plan).some((key) => !["version", "departments", "contentHash"].includes(key))) {
    throw new InvalidHeadActivationPlanError("Head activation plan contains unknown fields");
  }
  if (typeof plan.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(plan.contentHash)) {
    throw new InvalidHeadActivationPlanError("Head activation plan content hash is required");
  }
  if (plan.contentHash !== headActivationPlanContentHash(plan))
    throw new InvalidHeadActivationPlanError("Head activation plan content hash does not match its content");
}

function assertValidHeadActivationPlanInput(value: unknown): asserts value is HeadActivationPlanInput {
  if (
    !isObject(value) ||
    value.version !== HEAD_ACTIVATION_PLAN_VERSION ||
    !Array.isArray(value.departments) ||
    value.departments.length === 0
  ) {
    throw new InvalidHeadActivationPlanError("Head activation plan must contain departments");
  }
  const ids = new Set<string>();
  for (const department of value.departments) {
    if (!isObject(department)) throw new InvalidHeadActivationPlanError("Head activation department brief is invalid");
    if (
      Object.keys(department).some(
        (key) => !["departmentId", "requestedContribution", "urgency", "contextScope", "budgetEffect", "reason"].includes(key),
      )
    ) {
      throw new InvalidHeadActivationPlanError("Head activation department brief contains unknown fields");
    }
    for (const field of ["departmentId", "requestedContribution", "urgency", "budgetEffect", "reason"] as const) {
      if (typeof department[field] !== "string" || department[field].trim() === "") {
        throw new InvalidHeadActivationPlanError(`Head activation department ${field} is required`);
      }
    }
    if (
      !Array.isArray(department.contextScope) ||
      department.contextScope.length === 0 ||
      department.contextScope.some((entry) => typeof entry !== "string" || entry.trim() === "")
    ) {
      throw new InvalidHeadActivationPlanError("Head activation department contextScope is required");
    }
    const departmentId = department.departmentId;
    if (typeof departmentId !== "string" || departmentId.trim() === "")
      throw new InvalidHeadActivationPlanError("Head activation department departmentId is required");
    if (ids.has(departmentId)) throw new InvalidHeadActivationPlanError("Head activation department IDs must be unique");
    ids.add(departmentId);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
