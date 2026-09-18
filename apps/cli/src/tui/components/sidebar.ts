import { fitPlain, tuiTheme } from "../theme.js";
import { MAX_SIDEBAR_GOALS, moveSidebarFocus } from "./sidebar-nav.js";

export const SIDEBAR_WIDTH = 26;
export const SIDEBAR_MIN_COLUMNS = 100;

export function isSidebarVisible(explicit: boolean, columns: number): boolean {
  return explicit && columns >= SIDEBAR_MIN_COLUMNS;
}

export function contentWidth(columns: number, sidebarVisible: boolean): number {
  if (!isSidebarVisible(sidebarVisible, columns)) return columns;
  return Math.max(0, columns - SIDEBAR_WIDTH);
}

export interface SidebarToggleHost {
  sidebarVisible: boolean;
  sidebarFocus: string | undefined;
  readonly view: { render(): void };
}

/**
 * Toggle visibility; focus follows visibility (first row on show, cleared
 * on hide). Callers pass the nav rows so focus stays valid.
 */
export function toggleSidebar(host: SidebarToggleHost, rows: readonly { id: string }[]): void {
  if (host.sidebarVisible) {
    host.sidebarVisible = false;
    host.sidebarFocus = undefined;
  } else {
    host.sidebarVisible = true;
    host.sidebarFocus = moveSidebarFocus(host.sidebarFocus, 1, rows);
  }
  host.view.render();
}

export interface SidebarRow {
  label: string;
  value?: string;
  id?: string;
  selectable?: boolean;
  focused?: boolean;
}

export interface SidebarSection {
  title?: string;
  rows: SidebarRow[];
}

const LABEL_WIDTH = 8;

function renderRow(row: SidebarRow, width: number): string {
  if (row.selectable === true) {
    const cells = `${row.focused === true ? "› " : "  "}${fitPlain(row.label, Math.max(0, width - 2))}`.padEnd(width);
    return row.focused === true ? tuiTheme.primary(cells) : tuiTheme.text(cells);
  }
  const labelWidth = Math.min(LABEL_WIDTH, width);
  const valueWidth = Math.max(0, width - labelWidth - 1);
  const cells =
    valueWidth > 0
      ? `${fitPlain(row.label, labelWidth).padEnd(labelWidth)} ${fitPlain(row.value ?? "", valueWidth)}`.padEnd(width)
      : fitPlain(row.label, width);
  return tuiTheme.text(cells);
}

/**
 * Fixed-width bordered shell; sections slot between title and bottom rule.
 * Later findings append inbox/channel/footer groups here.
 */
export function renderSidebar(width: number, sections: readonly SidebarSection[] = []): string[] {
  if (width <= 0) return [];
  const rule = tuiTheme.border("─".repeat(width));
  const body: string[] = [];
  for (const section of sections) {
    if (section.title !== undefined) body.push(tuiTheme.muted(fitPlain(section.title, width).padEnd(width)));
    for (const row of section.rows) body.push(renderRow(row, width));
  }
  return [rule, tuiTheme.primary(fitPlain(" sidebar", width).padEnd(width)), ...body, rule];
}

/** Nav rows for a section, focus-marked without disturbing other groups. */
export function renderNavSection(
  rows: readonly { id: string; label: string }[],
  focusedId: string | undefined,
  badges: Record<string, string> = {},
): SidebarSection {
  return {
    title: "views",
    rows: rows.map((row) => ({
      label: badges[row.id] === undefined ? row.label : `${row.label} ${badges[row.id]}`,
      id: row.id,
      selectable: true,
      focused: focusedId === row.id,
    })),
  };
}

export interface SidebarGoal {
  goalId: string;
  state: string;
}

function goalRowLabel(goal: SidebarGoal, selected: boolean): string {
  return `${selected ? "• " : ""}${goal.goalId.slice(0, 8)} · ${goal.state}`;
}

/**
 * Cached goal rows for keyboard/mouse switching. Hidden while the dashboard
 * cache is empty; capped so the sidebar keeps its fixed height budget.
 */
export function renderGoalSection(
  goals: readonly SidebarGoal[],
  selectedId: string | undefined,
  focusedId: string | undefined,
): SidebarSection | undefined {
  if (goals.length === 0) return undefined;
  const visible = goals.slice(0, MAX_SIDEBAR_GOALS);
  const rows: SidebarRow[] = visible.map((goal) => ({
    label: goalRowLabel(goal, goal.goalId === selectedId),
    id: goal.goalId,
    selectable: true,
    focused: goal.goalId === focusedId,
  }));
  if (goals.length > visible.length) rows.push({ label: `+${goals.length - visible.length} more`, selectable: false });
  return { title: "goals", rows };
}

/**
 * Trailing key hints. Non-selectable label/value rows: no focus id, no
 * resolver, no dispatcher. Text avoids every nav label so the content-search
 * nav resolver can never match a footer line.
 */
export function renderFooterSection(): SidebarSection {
  return {
    title: "keys",
    rows: [
      { label: "up/dn", value: "move · enter open" },
      { label: "esc", value: "unfocus · ctrl+b" },
    ],
  };
}
