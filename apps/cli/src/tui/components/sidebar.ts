import { fitPlain, tuiTheme } from "../theme.js";

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
  readonly view: { render(): void };
}

/** Flip the explicit sidebar flag; the width gate decides actual visibility. */
export function toggleSidebar(host: SidebarToggleHost): void {
  host.sidebarVisible = !host.sidebarVisible;
  host.view.render();
}

export interface SidebarRow {
  label: string;
  value?: string;
  id?: string;
  selectable?: boolean;
}

export interface SidebarSection {
  title?: string;
  rows: SidebarRow[];
}

const LABEL_WIDTH = 8;

function renderRow(row: SidebarRow, width: number): string {
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
 * Later findings append nav/inbox/channel/footer groups here.
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
