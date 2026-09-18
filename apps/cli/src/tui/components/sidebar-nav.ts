import type { ApprovalDialogSummary, ConfirmationResult } from "../confirmation.js";
import { applyApprovalAction } from "./approval-dialog-click.js";
import { compactReviewAcknowledgement } from "../entry-helpers.js";
import { renderPendingDecisionDetails, type TuiShellState } from "./shell.js";

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
