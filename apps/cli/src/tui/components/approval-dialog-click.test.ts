import { afterEach, describe, expect, it, vi } from "vitest";
import { TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import { renderApprovalDialog } from "./approval-dialog.js";
import {
  applyApprovalAction,
  approvalDialogClickLines,
  createApprovalClickRegion,
  resolveApprovalClickAction,
  type ApprovalDialogAction,
  type ApprovalDialogHost,
} from "./approval-dialog-click.js";
import { sendClick, StubTerminal } from "./stub-terminal.js";

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

const fullSummary = {
  tier: "Encore Council" as const,
  tierTrigger: "effect" as const,
  pressure: 118,
  pressureBand: "high" as const,
  pressureTier: "Encore Council" as const,
  effects: [
    { classification: "ordinary" as const, action: "project.file.edit", target: "src/server.ts" },
    { classification: "critical" as const, action: "git.remote.push", target: "origin/main", setsTier: true },
  ],
  repetitionScope: "once" as const,
  saferAlternative: "Prepare a patch without applying it.",
  action: "git.remote.push",
  target: "origin/main",
  goalId: "goal-1",
  effect: "Push remote changes",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

const legacySummary = {
  action: "deploy",
  target: "staging",
  effect: "Release to staging",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

function rowWhere(lines: readonly string[], needle: string): number {
  return lines.map(stripAnsi).findIndex((line) => line.includes(needle));
}

function fakeHost(summary: typeof fullSummary): ApprovalDialogHost & { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  return {
    pendingConfirmation: { summary, resolve },
    compactReview: undefined,
    terminal: { columns: 100, rows: 30 },
    contentWidth: () => 100,
    view: { append: vi.fn(), appendWarning: vi.fn(), render: vi.fn(), syncPendingDecisionState: vi.fn() },
    resolve,
  };
}

describe("approval dialog click mapping", () => {
  it("maps scope option spans to set-scope actions", () => {
    const lines = renderApprovalDialog(fullSummary, 100);
    const row = rowWhere(lines, "Scope");
    expect(row).toBeGreaterThanOrEqual(0);
    const text = stripAnsi(lines[row]!);
    expect(resolveApprovalClickAction(lines, text.indexOf("5 more") + 2, row)).toEqual({ kind: "set-scope", scope: "bounded_count" });
    expect(resolveApprovalClickAction(lines, text.indexOf("this session") + 2, row)).toEqual({ kind: "set-scope", scope: "session" });
    expect(resolveApprovalClickAction(lines, text.indexOf("once") + 1, row)).toEqual({ kind: "set-scope", scope: "once" });
  });

  it("maps the hint spans to approve, reject, and why", () => {
    const lines = renderApprovalDialog(fullSummary, 100);
    const row = rowWhere(lines, "y approve");
    expect(row).toBeGreaterThanOrEqual(0);
    const text = stripAnsi(lines[row]!);
    expect(resolveApprovalClickAction(lines, text.indexOf("y approve") + 1, row)).toEqual({ kind: "resolve", decision: "approved" });
    expect(resolveApprovalClickAction(lines, text.indexOf("n reject") + 1, row)).toEqual({ kind: "resolve", decision: "cancelled" });
    expect(resolveApprovalClickAction(lines, text.indexOf("? why") + 1, row)).toEqual({ kind: "why" });
  });

  it("ignores unmapped rows, gaps between spans, and out-of-range coordinates", () => {
    const lines = renderApprovalDialog(fullSummary, 100);
    const separator = rowWhere(lines, "───");
    expect(separator).toBeGreaterThanOrEqual(0);
    expect(resolveApprovalClickAction(lines, 5, separator)).toBeUndefined();
    const scopeRow = rowWhere(lines, "Scope");
    expect(resolveApprovalClickAction(lines, 0, scopeRow)).toBeUndefined();
    expect(resolveApprovalClickAction(lines, 5, -1)).toBeUndefined();
    expect(resolveApprovalClickAction(lines, 5, lines.length)).toBeUndefined();
  });

  it("supports the legacy dialog approve and cancel spans without scope", () => {
    const lines = renderApprovalDialog(legacySummary, 100);
    const row = rowWhere(lines, "Press y to approve");
    expect(row).toBeGreaterThanOrEqual(0);
    const text = stripAnsi(lines[row]!);
    expect(resolveApprovalClickAction(lines, text.indexOf("y to approve") + 1, row)).toEqual({ kind: "resolve", decision: "approved" });
    expect(resolveApprovalClickAction(lines, text.indexOf("n to cancel") + 1, row)).toEqual({ kind: "resolve", decision: "cancelled" });
    expect(rowWhere(lines, "Scope")).toBe(-1);
  });

  it("returns undefined when truncation removes a label", () => {
    const lines = renderApprovalDialog(fullSummary, 30);
    const row = rowWhere(lines, "y approve");
    expect(row).toBeGreaterThanOrEqual(0);
    const text = stripAnsi(lines[row]!);
    expect(text.includes("? why")).toBe(false);
    expect(resolveApprovalClickAction(lines, 29, row)).toBeUndefined();
    expect(resolveApprovalClickAction(lines, text.indexOf("y approve") + 1, row)).toEqual({ kind: "resolve", decision: "approved" });
  });
});

describe("approval dialog shared actions", () => {
  it("approves with the current repetition scope and clears the confirmation", () => {
    const host = fakeHost(fullSummary);
    expect(applyApprovalAction(host, { kind: "resolve", decision: "approved" })).toBe(true);
    expect(host.resolve).toHaveBeenCalledWith({ decision: "approved", repetitionScope: "once" });
    expect(host.pendingConfirmation).toBeUndefined();
  });

  it("approves a scopeless legacy dialog as a bare approval", () => {
    const host = fakeHost(legacySummary);
    expect(applyApprovalAction(host, { kind: "resolve", decision: "approved" })).toBe(true);
    expect(host.resolve).toHaveBeenCalledWith("approved");
  });

  it("rejects without proposing anything by itself", () => {
    const host = fakeHost(fullSummary);
    expect(applyApprovalAction(host, { kind: "resolve", decision: "cancelled" })).toBe(true);
    expect(host.resolve).toHaveBeenCalledWith("cancelled");
    expect(host.pendingConfirmation).toBeUndefined();
  });

  it("explains the tier and scope without resolving", () => {
    const host = fakeHost(fullSummary);
    expect(applyApprovalAction(host, { kind: "why" })).toBe(true);
    expect(host.resolve).not.toHaveBeenCalled();
    expect(host.pendingConfirmation).not.toBeUndefined();
  });

  it("sets and cycles the repetition scope without resolving", () => {
    const host = fakeHost(fullSummary);
    expect(applyApprovalAction(host, { kind: "set-scope", scope: "session" })).toBe(true);
    expect(host.pendingConfirmation?.summary.repetitionScope).toBe("session");
    expect(host.resolve).not.toHaveBeenCalled();
    expect(applyApprovalAction(host, { kind: "cycle-scope", direction: 1 })).toBe(true);
    expect(host.pendingConfirmation?.summary.repetitionScope).toBe("once");
  });

  it("does nothing without a pending confirmation", () => {
    const host = fakeHost(fullSummary);
    host.pendingConfirmation = undefined;
    expect(applyApprovalAction(host, { kind: "resolve", decision: "approved" })).toBe(false);
    expect(applyApprovalAction(host, { kind: "why" })).toBe(false);
    expect(applyApprovalAction(host, { kind: "set-scope", scope: "once" })).toBe(false);
    expect(host.resolve).not.toHaveBeenCalled();
  });

  it("returns no lines without a pending confirmation", () => {
    expect(approvalDialogClickLines({ pendingConfirmation: undefined }, 100)).toEqual([]);
    const host = fakeHost(fullSummary);
    expect(approvalDialogClickLines(host, 100)).toEqual(renderApprovalDialog(fullSummary, 100));
  });
});

describe("approval dialog click region", () => {
  const screens: TuiAltScreen[] = [];
  afterEach(() => {
    for (const screen of screens) screen.stop();
    screens.length = 0;
  });

  it("routes a real SGR click on the approve span to the shared resolve action", () => {
    const terminal = new StubTerminal();
    const tui = new TuiAltScreen(terminal);
    screens.push(tui);
    const actions: ApprovalDialogAction[] = [];
    const region = createApprovalClickRegion({
      lines: (width) => renderApprovalDialog(fullSummary, width),
      onAction: (action) => actions.push(action),
    });
    tui.setLayoutRoot(new VStack([{ component: region, basis: "auto" }]));
    tui.start();
    tui.renderNow(true);

    const rendered = renderApprovalDialog(fullSummary, terminal.columns);
    const row = rendered.map((line) => line).findIndex((line) => line.includes("y approve"));
    expect(row).toBeGreaterThanOrEqual(0);
    const column = rendered[row]!.indexOf("y approve") + 1;
    sendClick(terminal, column + 1, row + 1);

    expect(actions).toEqual([{ kind: "resolve", decision: "approved" }]);
  });

  it("ignores a click on an unmapped row", () => {
    const terminal = new StubTerminal();
    const tui = new TuiAltScreen(terminal);
    screens.push(tui);
    const actions: ApprovalDialogAction[] = [];
    const region = createApprovalClickRegion({
      lines: (width) => renderApprovalDialog(fullSummary, width),
      onAction: (action) => actions.push(action),
    });
    tui.setLayoutRoot(new VStack([{ component: region, basis: "auto" }]));
    tui.start();
    tui.renderNow(true);

    const rendered = renderApprovalDialog(fullSummary, terminal.columns);
    const row = rendered.findIndex((line) => line.includes("───"));
    expect(row).toBeGreaterThanOrEqual(0);
    sendClick(terminal, 5, row + 1);

    expect(actions).toEqual([]);
  });
});
