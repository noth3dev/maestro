import type { GoalPlan, GoalPlanSliceRead } from "@maestro/contracts";

/** Board columns in flow order. `blocked` is a marker on a card, not a column. */
export const KANBAN_COLUMNS = ["planned", "approved", "in_progress", "review", "done"] as const;
export type KanbanColumn = (typeof KANBAN_COLUMNS)[number];

export const kanbanColumnLabels: Record<KanbanColumn, string> = {
  planned: "planned",
  approved: "approved",
  in_progress: "in progress",
  review: "review",
  done: "done",
};

export interface KanbanCard {
  readonly slice: GoalPlanSliceRead;
  readonly column: KanbanColumn;
  readonly blocked: boolean;
  /** Dependencies not yet done — the reason a card cannot start. */
  readonly waitingOn: readonly string[];
}

export interface KanbanLane {
  readonly departmentId: string;
  readonly cells: Readonly<Record<KanbanColumn, readonly KanbanCard[]>>;
  readonly total: number;
  readonly done: number;
}

export interface KanbanBoard {
  readonly lanes: readonly KanbanLane[];
  readonly totals: Readonly<Record<KanbanColumn, number>>;
  readonly blocked: number;
  readonly phases: GoalPlan["phases"];
}

/**
 * A blocked slice stays in the column it was in; the status row keeps only
 * `blocked`, so it is shown where its work stopped: before approval it sits in
 * planned, afterwards in progress.
 */
function columnFor(slice: GoalPlanSliceRead, planApproved: boolean): KanbanColumn {
  if (slice.status !== "blocked") return slice.status;
  return planApproved ? "in_progress" : "planned";
}

function emptyCells(): Record<KanbanColumn, KanbanCard[]> {
  return { planned: [], approved: [], in_progress: [], review: [], done: [] };
}

export function departmentLabel(departmentId: string): string {
  return departmentId.split(/[-_]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

/** Group one Goal plan into department swimlanes × status columns (slices keep plan order). */
export function buildKanbanBoard(plan: GoalPlan): KanbanBoard {
  const planApproved = plan.status === "approved";
  const done = new Set(plan.slices.filter((slice) => slice.status === "done").map((slice) => slice.sliceId));
  const lanes = new Map<string, Record<KanbanColumn, KanbanCard[]>>();
  const totals: Record<KanbanColumn, number> = { planned: 0, approved: 0, in_progress: 0, review: 0, done: 0 };
  let blocked = 0;
  for (const slice of plan.slices) {
    const column = columnFor(slice, planApproved);
    const cells = lanes.get(slice.departmentId) ?? emptyCells();
    lanes.set(slice.departmentId, cells);
    cells[column].push({ slice, column, blocked: slice.status === "blocked", waitingOn: slice.dependsOn.filter((id) => !done.has(id)) });
    totals[column] += 1;
    if (slice.status === "blocked") blocked += 1;
  }
  return {
    lanes: [...lanes.entries()]
      .map(([departmentId, cells]) => ({
        departmentId,
        cells,
        total: KANBAN_COLUMNS.reduce((sum, column) => sum + cells[column].length, 0),
        done: cells.done.length,
      }))
      .sort((left, right) => left.departmentId.localeCompare(right.departmentId)),
    totals,
    blocked,
    phases: plan.phases,
  };
}

/** Short Korean-free status line for the board header, e.g. "draft · v2 · 3/12 done". */
export function planSummary(plan: GoalPlan): string {
  const done = plan.slices.filter((slice) => slice.status === "done").length;
  const status = plan.status === "draft" ? "awaiting Encore approval" : plan.status === "awaiting_approval" ? "needs your decision" : plan.status;
  return `${status} · v${plan.version} · ${done}/${plan.slices.length} done`;
}
