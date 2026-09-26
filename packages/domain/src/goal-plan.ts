import { sha256Hex } from "./hash.js";
import { canonicalJson } from "./task-contract.js";

/**
 * The Department Heads' detailed execution plan for one Goal: cross-department
 * phases, and slices (`p<phase>s<n>`) each owned by exactly one department.
 */
export class InvalidGoalPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGoalPlanError";
  }
}

export const GOAL_PLAN_STATUSES = ["draft", "awaiting_approval", "approved", "superseded", "rejected"] as const;
export type GoalPlanStatus = (typeof GOAL_PLAN_STATUSES)[number];

export const GOAL_PLAN_SLICE_STATUSES = ["planned", "approved", "in_progress", "review", "done", "blocked"] as const;
export type GoalPlanSliceStatus = (typeof GOAL_PLAN_SLICE_STATUSES)[number];

export interface GoalPlanPhase {
  readonly phaseNo: number;
  readonly title: string;
  /** The user-visible outcome that finishes the phase. */
  readonly outcome: string;
}

export interface GoalPlanSlice {
  /** `p<phase>s<n>`, e.g. `p1s22`. */
  readonly sliceId: string;
  readonly phaseNo: number;
  readonly departmentId: string;
  readonly title: string;
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly dependsOn: readonly string[];
}

export interface GoalPlanSubstance {
  readonly phases: readonly GoalPlanPhase[];
  readonly slices: readonly GoalPlanSlice[];
}

const SLICE_ID = /^p([1-9][0-9]*)s([1-9][0-9]*)$/;

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 4_000) throw new InvalidGoalPlanError(`${field} is required`);
}

function texts(value: unknown, field: string, { nonEmpty }: { nonEmpty: boolean }): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > 64 || (nonEmpty && value.length === 0)) throw new InvalidGoalPlanError(`${field} must be a list`);
  value.forEach((entry, index) => text(entry, `${field}[${index}]`));
}

/** Validate structure, numbering, ownership, and that dependencies form a DAG inside the plan. */
export function assertValidGoalPlan(value: unknown): asserts value is GoalPlanSubstance {
  if (value === null || typeof value !== "object") throw new InvalidGoalPlanError("Goal plan must be an object");
  const plan = value as { phases?: unknown; slices?: unknown };
  if (!Array.isArray(plan.phases) || plan.phases.length === 0 || plan.phases.length > 64) throw new InvalidGoalPlanError("Goal plan needs 1–64 phases");
  if (!Array.isArray(plan.slices) || plan.slices.length === 0 || plan.slices.length > 512) throw new InvalidGoalPlanError("Goal plan needs 1–512 slices");
  const phaseNos = new Set<number>();
  for (const [index, phase] of (plan.phases as GoalPlanPhase[]).entries()) {
    if (!Number.isSafeInteger(phase.phaseNo) || phase.phaseNo < 1) throw new InvalidGoalPlanError(`phases[${index}].phaseNo must be a positive integer`);
    if (phaseNos.has(phase.phaseNo)) throw new InvalidGoalPlanError(`Duplicate phase ${phase.phaseNo}`);
    phaseNos.add(phase.phaseNo);
    text(phase.title, `phases[${index}].title`);
    text(phase.outcome, `phases[${index}].outcome`);
  }
  const sliceIds = new Set<string>();
  for (const [index, slice] of (plan.slices as GoalPlanSlice[]).entries()) {
    text(slice.sliceId, `slices[${index}].sliceId`);
    const match = SLICE_ID.exec(slice.sliceId);
    if (match === null) throw new InvalidGoalPlanError(`${slice.sliceId} is not a p<phase>s<n> slice id`);
    if (Number(match[1]) !== slice.phaseNo) throw new InvalidGoalPlanError(`${slice.sliceId} does not belong to phase ${slice.phaseNo}`);
    if (!phaseNos.has(slice.phaseNo)) throw new InvalidGoalPlanError(`${slice.sliceId} belongs to unknown phase ${slice.phaseNo}`);
    if (sliceIds.has(slice.sliceId)) throw new InvalidGoalPlanError(`Duplicate slice ${slice.sliceId}`);
    sliceIds.add(slice.sliceId);
    text(slice.departmentId, `${slice.sliceId}.departmentId`);
    text(slice.title, `${slice.sliceId}.title`);
    text(slice.objective, `${slice.sliceId}.objective`);
    texts(slice.acceptance, `${slice.sliceId}.acceptance`, { nonEmpty: true });
    texts(slice.dependsOn, `${slice.sliceId}.dependsOn`, { nonEmpty: false });
  }
  const slices = plan.slices as GoalPlanSlice[];
  for (const slice of slices)
    for (const dependency of slice.dependsOn) {
      if (!sliceIds.has(dependency)) throw new InvalidGoalPlanError(`${slice.sliceId} depends on unknown slice ${dependency}`);
      if (dependency === slice.sliceId) throw new InvalidGoalPlanError(`${slice.sliceId} depends on itself`);
    }
  const byId = new Map(slices.map((slice) => [slice.sliceId, slice] as const));
  const done = new Set<string>();
  const visit = (id: string, path: readonly string[]) => {
    if (path.includes(id)) throw new InvalidGoalPlanError(`Slice dependencies form a cycle: ${[...path, id].join(" → ")}`);
    if (done.has(id)) return;
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency, [...path, id]);
    done.add(id);
  };
  for (const slice of slices) visit(slice.sliceId, []);
}

export function goalPlanContentHash(plan: GoalPlanSubstance): string {
  return sha256Hex(canonicalJson(plan));
}
