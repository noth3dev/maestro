import type { Component } from "@earendil-works/pi-tui";
import {
  nextApprovalDialogScope,
  type ApprovalDialogRepetitionScope,
  type ApprovalDialogSummary,
  type ConfirmationResult,
} from "../confirmation.js";
import { compactReviewAcknowledgement } from "../entry-helpers.js";
import { renderApprovalDialog } from "./approval-dialog.js";
import { createClickRegion } from "./mouse.js";

export type ApprovalDialogAction =
  | { kind: "resolve"; decision: "approved" | "cancelled" }
  | { kind: "why" }
  | { kind: "set-scope"; scope: ApprovalDialogRepetitionScope }
  | { kind: "cycle-scope"; direction: 1 | -1 }
  | { kind: "reveal" };

export interface ApprovalDialogHost {
  pendingConfirmation: { summary: ApprovalDialogSummary; resolve: (decision: ConfirmationResult) => void } | undefined;
  compactReview: string | undefined;
  readonly terminal: { readonly columns: number; readonly rows: number };
  readonly view: {
    append(line: string): void;
    appendWarning(text: string): void;
    render(): void;
    syncPendingDecisionState(): void;
  };
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function inSpan(text: string, label: string, x: number): boolean {
  const start = text.indexOf(label);
  return start !== -1 && x >= start && x < start + label.length;
}

// Labels mirror scopeLine in approval-dialog.ts: option order and wording are
// the clickable surface, so the resolver searches content, never fixed offsets.
const SCOPE_LABELS: ReadonlyArray<{ label: string; scope: ApprovalDialogRepetitionScope }> = [
  { label: "once", scope: "once" },
  { label: "5 more", scope: "bounded_count" },
  { label: "this session", scope: "session" },
];

/**
 * Map a click in rendered dialog lines to the same action the keyboard path
 * would take. Coordinates are component-local zero-based cells, matching
 * TuiMouseEvent. Anything unmapped (borders, effects, gaps, truncated labels)
 * returns undefined so the click stays a no-op.
 */
export function resolveApprovalClickAction(
  lines: readonly string[],
  x: number,
  y: number,
): ApprovalDialogAction | undefined {
  if (!Number.isInteger(y) || y < 0 || y >= lines.length) return undefined;
  const text = stripAnsi(lines[y] ?? "");
  if (!Number.isInteger(x) || x < 0 || x >= text.length) return undefined;
  if (text.includes("Scope") && text.includes("[")) {
    for (const { label, scope } of SCOPE_LABELS) {
      if (inSpan(text, label, x)) return { kind: "set-scope", scope };
    }
    return undefined;
  }
  if (text.includes("y approve")) {
    if (inSpan(text, "y approve", x)) return { kind: "resolve", decision: "approved" };
    if (inSpan(text, "n reject", x)) return { kind: "resolve", decision: "cancelled" };
    if (inSpan(text, "? why", x)) return { kind: "why" };
    return undefined;
  }
  if (text.includes("Press y to approve")) {
    if (inSpan(text, "y to approve", x)) return { kind: "resolve", decision: "approved" };
    if (inSpan(text, "n to cancel", x)) return { kind: "resolve", decision: "cancelled" };
    return undefined;
  }
  return undefined;
}

/**
 * Apply one approval action against the live controller state. Both the
 * keyboard branch in lifecycle.ts and the click region call these, so the
 * ceremony (resolve values, clearing, re-rendering) stays identical.
 */
export function applyApprovalAction(host: ApprovalDialogHost, action: ApprovalDialogAction): boolean {
  const pending = host.pendingConfirmation;
  if (pending === undefined) return false;
  switch (action.kind) {
    case "cycle-scope": {
      if (pending.summary.repetitionScope === undefined) return false;
      host.pendingConfirmation = {
        ...pending,
        summary: { ...pending.summary, repetitionScope: nextApprovalDialogScope(pending.summary.repetitionScope, action.direction) },
      };
      host.view.render();
      return true;
    }
    case "set-scope": {
      if (pending.summary.repetitionScope === undefined) return false;
      if (pending.summary.repetitionScope === action.scope) return true;
      host.pendingConfirmation = { ...pending, summary: { ...pending.summary, repetitionScope: action.scope } };
      host.view.render();
      return true;
    }
    case "why": {
      const { summary } = pending;
      host.view.appendWarning(
        `Approval tier: ${summary.tier === "user" ? "You" : (summary.tier ?? "You")}; scope: ${summary.repetitionScope ?? "once"}. Reject proposes: ${summary.saferAlternative ?? "a safer alternative"}`,
      );
      return true;
    }
    case "resolve": {
      if (action.decision === "approved") {
        const decision: ConfirmationResult =
          pending.summary.repetitionScope === undefined
            ? "approved"
            : { decision: "approved", repetitionScope: pending.summary.repetitionScope };
        const resolveConfirmation = pending.resolve;
        host.pendingConfirmation = undefined;
        host.view.syncPendingDecisionState();
        resolveConfirmation(decision);
        host.view.render();
        return true;
      }
      const resolveConfirmation = pending.resolve;
      host.pendingConfirmation = undefined;
      host.view.syncPendingDecisionState();
      resolveConfirmation("cancelled");
      host.view.render();
      return true;
    }
    case "reveal": {
      host.compactReview =
        host.terminal.rows < 16 ? compactReviewAcknowledgement(pending.summary, [], host.terminal.columns) : undefined;
      host.view.append(renderApprovalDialog(pending.summary, host.terminal.columns).join("\n"));
      return true;
    }
  }
}

export function approvalDialogClickLines(
  host: Pick<ApprovalDialogHost, "pendingConfirmation">,
  width: number,
): string[] {
  const summary = host.pendingConfirmation?.summary;
  if (summary === undefined) return [];
  return renderApprovalDialog(summary, width);
}

/**
 * A rendering-neutral clickable wrapper around live dialog lines. The layout
 * width of the last rendered frame maps click cells back onto the same lines,
 * so span lookup always matches what the operator sees.
 */
export function createApprovalClickRegion(options: {
  lines: (width: number) => readonly string[];
  onAction: (action: ApprovalDialogAction) => void;
}): Component {
  return createClickRegion({
    lines: options.lines,
    resolve: (lines, x, y) => resolveApprovalClickAction(lines, x, y),
    onAction: options.onAction,
  });
}
