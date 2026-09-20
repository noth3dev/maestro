import { fitPlain, tuiTheme } from "../theme.js";
import { MAX_SIDEBAR_GOALS, moveSidebarFocus, NAV_ROWS } from "./sidebar-nav.js";

export const SIDEBAR_WIDTH = 26;
export const SIDEBAR_MIN_COLUMNS = 100;

export function isSidebarVisible(explicit: boolean, columns: number): boolean {
  return explicit && columns >= SIDEBAR_MIN_COLUMNS;
}

export function contentWidth(columns: number, sidebarVisible: boolean): number {
  if (!isSidebarVisible(sidebarVisible, columns)) return columns;
  return Math.max(0, columns - SIDEBAR_WIDTH);
}

/** One-line current-view cue used when the full sidebar is hidden by terminal width. */
export function renderNarrowCurrentView(selection: string | undefined, width: number): string[] {
  const row = NAV_ROWS.find((candidate) => candidate.id === selection);
  if (row === undefined || width <= 0) return [];
  return [tuiTheme.dim(fitPlain(`view · ${row.label}`, width))];
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
  selected?: boolean;
}

export interface SidebarSection {
  title?: string;
  rows: SidebarRow[];
}

const LABEL_WIDTH = 8;

function renderRow(row: SidebarRow, width: number): string {
  if (row.selectable === true) {
    const marker = row.focused === true ? "› " : row.selected === true ? "• " : "  ";
    const cells = `${marker}${fitPlain(row.label, Math.max(0, width - 2))}`.padEnd(width);
    if (row.focused === true) return tuiTheme.selected(tuiTheme.primary(cells));
    if (row.selected === true) return tuiTheme.primary(cells);
    return tuiTheme.text(cells);
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
 * Open pane in the opencode SplitBorder manner: no box, one heavy vertical
 * divider at the content edge, one blank padded gap between sections, and
 * accent section titles. Content narrows by the divider cell; every line
 * keeps the full width so the divider column stays chrome for clicks.
 */
export function renderSidebar(width: number, sections: readonly SidebarSection[] = []): string[] {
  if (width <= 0) return [];
  const inner = Math.max(0, width - 1);
  const divider = tuiTheme.border("┃");
  const gap = " ".repeat(inner);
  const body: string[] = [];
  for (const [index, section] of sections.entries()) {
    if (index > 0) body.push(gap);
    if (section.title !== undefined) body.push(tuiTheme.primary(fitPlain(section.title, inner).padEnd(inner)));
    for (const row of section.rows) body.push(renderRow(row, inner));
  }
  return body.map((line) => `${line}${divider}`);
}

/** Nav rows for a section, focus-marked without disturbing other groups. */
export function renderNavSection(
  rows: readonly { id: string; label: string }[],
  focusedId: string | undefined,
  badges: Record<string, string> = {},
  selectedId: string | undefined = undefined,
): SidebarSection {
  return {
    title: "views",
    rows: rows.map((row) => ({
      label: badges[row.id] === undefined ? row.label : `${row.label} ${badges[row.id]}`,
      id: row.id,
      selectable: true,
      focused: focusedId === row.id,
      selected: selectedId === row.id,
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
