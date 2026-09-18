import type { ApprovalDialogSummary, ConfirmationResult } from "../confirmation.js";
import { applyApprovalAction } from "./approval-dialog-click.js";
import { compactReviewAcknowledgement } from "../entry-helpers.js";
import { renderPendingDecisionDetails, type TuiShellState } from "./shell.js";
import { MAX_SIDEBAR_CHANNELS } from "./sidebar-channels.js";

export interface SidebarNavRow {
  id: string;
  label: string;
  action: { kind: "submit"; text: string } | { kind: "home" } | { kind: "inbox" };
}

export const NAV_ROWS: readonly SidebarNavRow[] = [
  { id: "home", label: "home", action: { kind: "home" } },
  { id: "inbox", label: "inbox", action: { kind: "inbox" } },
  { id: "channel", label: "channel", action: { kind: "submit", text: "/channel list" } },
  { id: "evlog", label: "evlog", action: { kind: "submit", text: "/events list" } },
  { id: "billing", label: "billing", action: { kind: "submit", text: "/billing get" } },
  { id: "luthiery", label: "luthiery", action: { kind: "submit", text: "/luthiery list" } },
];

/** Rendered goal rows stay capped so keyboard, mouse, and paint agree. */
export const MAX_SIDEBAR_GOALS = 5;

export function moveSidebarFocus(
  current: string | undefined,
  direction: 1 | -1,
  rows: readonly { id: string }[],
): string | undefined {
  if (rows.length === 0) return undefined;
  const index = rows.findIndex((row) => row.id === current);
  if (index === -1) return direction === 1 ? rows[0]!.id : rows[rows.length - 1]!.id;
  return rows[(index + direction + rows.length) % rows.length]!.id;
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Map a click to a nav row by label content, never by fixed offsets.
 * Truncated labels and chrome rows resolve to undefined (no-op).
 */
export function resolveSidebarNavClick(lines: readonly string[], x: number, y: number): string | undefined {
  if (!Number.isInteger(y) || y < 0 || y >= lines.length) return undefined;
  const text = stripAnsi(lines[y] ?? "");
  if (!Number.isInteger(x) || x < 0 || x >= text.length) return undefined;
  for (const row of NAV_ROWS) {
    if (text.includes(row.label)) return row.id;
  }
  return undefined;
}

export interface SidebarNavHost {
  readonly submitter: { submit(text: string): void };
  readonly splash: { restore(): void };
  readonly tui: { requestRender(force: boolean): void };
  compactReview: string | undefined;
  readonly pendingConfirmation:
    | { summary: ApprovalDialogSummary; resolve: (decision: ConfirmationResult) => void }
    | undefined;
  readonly state: TuiShellState;
  readonly terminal: { readonly columns: number; readonly rows: number };
  contentWidth(): number;
  /** Dashboard goal cache backing the goals section; ids only, never parsed from paint. */
  readonly sidebarGoals: readonly { goalId: string }[];
  readonly view: {
    append(line: string): void;
    appendWarning(text: string): void;
    render(): void;
    syncPendingDecisionState(): void;
  };
}

export function showHome(host: Pick<SidebarNavHost, "splash" | "tui">): void {
  host.splash.restore();
  host.tui.requestRender(true);
}

export function activateInbox(host: SidebarNavHost): void {
  if (host.pendingConfirmation !== undefined) {
    applyApprovalAction(host, { kind: "reveal" });
    return;
  }
  host.compactReview =
    host.terminal.rows < 16
      ? compactReviewAcknowledgement(undefined, host.state.pendingDecisions ?? [], host.contentWidth())
      : undefined;
  host.view.append(renderPendingDecisionDetails(host.state, host.contentWidth()).join("\n"));
}

export function applySidebarNavAction(host: SidebarNavHost, id: string): void {
  const row = NAV_ROWS.find((candidate) => candidate.id === id);
  if (row === undefined) return;
  if (row.action.kind === "submit") {
    void host.submitter.submit(row.action.text);
    return;
  }
  if (row.action.kind === "home") {
    showHome(host);
    return;
  }
  activateInbox(host);
}

/**
 * Single dispatcher for sidebar activation (keyboard Enter and mouse click).
 * Nav ids run nav actions; cached goal ids submit a goal select; anything
 * else is a no-op so truncated paint can never trigger a foreign command.
 */
export function activateSidebarRow(host: SidebarNavHost, id: string): void {
  if (NAV_ROWS.some((row) => row.id === id)) {
    applySidebarNavAction(host, id);
    return;
  }
  if (host.sidebarGoals.some((goal) => goal.goalId === id)) {
    void host.submitter.submit(`/goal select --goal-id ${id}`);
  }
}

/** Focus order follows paint order: nav rows, then channels, then goals. */
export function sidebarFocusRows(
  goals: readonly { goalId: string }[] = [],
  channelKeys: readonly string[] = [],
): { id: string }[] {
  return [
    ...NAV_ROWS.map((row) => ({ id: row.id })),
    ...channelKeys.slice(0, MAX_SIDEBAR_CHANNELS).map((id) => ({ id })),
    ...goals.slice(0, MAX_SIDEBAR_GOALS).map((goal) => ({ id: goal.goalId })),
  ];
}

/**
 * Map a click to a cached goal id. Scoped to the goals block by title offset
 * (never by label search), with an id-slice guard so truncated rows no-op.
 */
export function resolveSidebarGoalClick(
  lines: readonly string[],
  goals: readonly { goalId: string }[],
  x: number,
  y: number,
): string | undefined {
  if (!Number.isInteger(y) || y < 0 || y >= lines.length) return undefined;
  const titleIndex = lines.findIndex((line) => stripAnsi(line).trim() === "goals");
  if (titleIndex === -1) return undefined;
  const offset = y - titleIndex - 1;
  const visible = goals.slice(0, MAX_SIDEBAR_GOALS);
  if (offset < 0 || offset >= visible.length) return undefined;
  const text = stripAnsi(lines[y] ?? "");
  if (!Number.isInteger(x) || x < 0 || x >= text.length) return undefined;
  const goal = visible[offset]!;
  if (!text.includes(goal.goalId.slice(0, 8))) return undefined;
  return goal.goalId;
}

export interface SidebarFocusHost {
  sidebarFocus: string | undefined;
  readonly pendingConfirmation: unknown;
  readonly accountLoginSelection: unknown;
  readonly accountLoginState: string | undefined;
}

/** Nav keys apply only when focused and no modal ceremony owns the input. */
export function isSidebarNavActive(host: SidebarFocusHost): boolean {
  if (host.sidebarFocus === undefined) return false;
  if (host.pendingConfirmation !== undefined) return false;
  if (host.accountLoginSelection !== undefined && host.accountLoginState === "selecting") return false;
  return true;
}
