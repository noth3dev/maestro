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

/** Fixed-width bordered shell; content sections arrive in later findings. */
export function renderSidebar(width: number): string[] {
  if (width <= 0) return [];
  const rule = tuiTheme.border("─".repeat(width));
  return [rule, tuiTheme.primary(fitPlain(" sidebar", width).padEnd(width)), rule];
}
