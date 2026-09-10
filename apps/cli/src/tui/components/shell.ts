import type { Workspace } from "../workspace.js";
import { fitPlain, tuiTheme } from "../theme.js";

export type AsyncState<T> = { kind: "loading" } | { kind: "empty" } | { kind: "error"; message: string } | { kind: "value"; value: T };

export interface PendingDecision {
  readonly tier: string;
  readonly action: string;
  readonly actor: string;
}

export interface TuiShellState {
  workspace: Workspace;
  model?: string;
  mode?: "maestro" | "flashmob";
  working?: boolean;
  connection:
    { kind: "connected" } | { kind: "connecting" } | { kind: "setup-required"; message: string } | { kind: "error"; message: string };
  goal: AsyncState<{ name: string; state: string }>;
  workers: AsyncState<number>;
  approvals: AsyncState<number>;
  budget: AsyncState<{ spentCents: number; ceilingCents: number }>;
  pendingDecisions?: readonly PendingDecision[];
}

export interface TuiLayoutFrame {
  readonly splash: string[];
  readonly status: string[];
  readonly stream: string[];
  readonly decisions: string[];
  readonly input: string[];
  readonly hints: string[];
}

export interface TuiLayoutOptions {
  readonly showSplash?: boolean;
  readonly stream?: readonly string[];
  readonly input?: readonly string[];
}

function stateText<T>(state: AsyncState<T>, format: (value: T) => string): string {
  if (state.kind === "loading") return "loading";
  if (state.kind === "empty") return "none";
  if (state.kind === "error") return `error: ${state.message}`;
  return format(state.value);
}

function goalText(state: TuiShellState): string {
  return stateText(state.goal, (value) => `${value.name} · ${value.state}`);
}

function goalStateText(state: TuiShellState): string {
  return stateText(state.goal, (value) => value.state);
}

function workerText(state: TuiShellState): string {
  return stateText(state.workers, (value) => `${value} worker${value === 1 ? "" : "s"}`);
}

function pendingCount(state: TuiShellState): number {
  if (state.pendingDecisions !== undefined) return state.pendingDecisions.length;
  return state.approvals.kind === "value" ? state.approvals.value : 0;
}

function budgetText(state: TuiShellState): string {
  if (state.budget.kind !== "value") return stateText(state.budget, String);
  const spent = (state.budget.value.spentCents / 100).toFixed(2);
  const ceiling = (state.budget.value.ceilingCents / 100).toFixed(2);
  return `$${spent}/$${ceiling}`;
}

function connectionMessage(state: TuiShellState): string | undefined {
  if (state.connection.kind === "connected") return undefined;
  if (state.connection.kind === "connecting") return "gateway connecting";
  return state.connection.message;
}

function pendingPaint(text: string): string { return tuiTheme.warning(text); }

/** One-line status, ordered by what can change the operator's next action. */
export function renderStatusRow(state: TuiShellState, width: number): string {
  const connection = connectionMessage(state);
  if (connection !== undefined) return tuiTheme.warning(fitPlain(`⚠ ${connection} · retry with ctrl+r`, width));

  const count = pendingCount(state);
  const pending = count > 0 ? ` · ⏸ ${count} need you` : "";
  let base: string;
  if (width >= 100) base = `${state.mode === "flashmob" ? "flashmob" : "maestro"} · ${goalText(state)} · ${workerText(state)} · ${budgetText(state)}`;
  else if (width >= 80) base = `${state.mode === "flashmob" ? "flashmob" : "maestro"} · ${goalText(state)} · ${workerText(state)}`;
  else if (width >= 60) base = `${state.mode === "flashmob" ? "flashmob" : "maestro"} · ${goalStateText(state)}`;
  else base = goalStateText(state);
  if (pending === "") return tuiTheme.text(fitPlain(base, width));
  const baseWidth = Math.max(0, width - pending.length);
  const left = fitPlain(base, baseWidth).padEnd(baseWidth, " ");
  return `${tuiTheme.text(left)}${pendingPaint(fitPlain(pending, width - baseWidth))}`;
}

function decisionRows(state: TuiShellState, width: number, height: number): string[] {
  const decisions = state.pendingDecisions ?? [];
  if (decisions.length === 0) return [];
  if (width < 60) return [fitPlain(`⏸ ${decisions.length} pending decisions · ctrl+a to review`, width)];
  const maxVisible = height < 24 ? 1 : 2;
  const visible = decisions.slice(0, maxVisible).map((decision) => {
    const actor = width >= 100 ? `  ${decision.actor}` : "";
    return fitPlain(`⏸ ${decision.tier}  ${decision.action}${actor}`, width);
  });
  if (decisions.length > visible.length) visible.push(fitPlain(`  +${decisions.length - visible.length} more · ctrl+a to review`, width));
  return visible;
}

export function renderDecisionRegion(state: TuiShellState, width: number, height = 24): string[] {
  if (height < 16) return [];
  const rows = decisionRows(state, width, height);
  if (rows.length === 0) return [];
  if (width < 60 || height < 24) return rows.map((row) => tuiTheme.warning(row));
  return [tuiTheme.border("─".repeat(Math.max(0, width))), ...rows.map((row) => tuiTheme.warning(row)), tuiTheme.border("─".repeat(Math.max(0, width)))];
}

/** Details shown by the one-keystroke review action when a decision was replayed from storage. */
export function renderPendingDecisionDetails(state: TuiShellState, width: number): string[] {
  return (state.pendingDecisions ?? []).map((decision) => fitPlain(`⏸ ${decision.tier} · ${decision.action} · requested by ${decision.actor}`, width));
}

function renderSplash(width: number): string[] {
  return [
    tuiTheme.primary(fitPlain("✦ MAESTRO", width)),
    tuiTheme.secondary(fitPlain("Your durable workspace for governed work", width)),
    tuiTheme.dim(fitPlain("Type / for commands · Ctrl+G goals · Ctrl+A decisions", width)),
  ];
}

export interface SplashController {
  visible(): boolean;
  dismiss(): void;
}

export function createSplashController(): SplashController {
  let isVisible = true;
  return { visible: () => isVisible, dismiss: () => { isVisible = false; } };
}

function hintText(state: TuiShellState): string {
  if (connectionMessage(state) !== undefined) return "ctrl+r retry · /status for detail";
  if (state.working === true) return `esc stop · ctrl+a decisions${pendingCount(state) > 0 ? ` (${pendingCount(state)})` : ""}`;
  const count = pendingCount(state);
  if (count > 0) return `ctrl+a review ${count} pending decision${count === 1 ? "" : "s"}`;
  if (state.workers.kind === "loading") return "esc stop · ctrl+a decisions";
  return "/ commands · ctrl+g goals · ? help";
}

export function renderHints(state: TuiShellState, width: number): string {
  return tuiTheme.dim(fitPlain(hintText(state), width));
}

export function renderTuiLayout(state: TuiShellState, width: number, height: number, options: TuiLayoutOptions = {}): TuiLayoutFrame {
  const splash = options.showSplash === true && width >= 100 && height >= 28 ? renderSplash(width) : [];
  const status = [renderStatusRow(state, width)];
  const decisions = renderDecisionRegion(state, width, height);
  const input = [fitPlain(options.input?.[0] ?? "message to Concertmaster · Enter to send", width)];
  const hints = [renderHints(state, width)];
  if (height < 16) return { splash, status, stream: [], decisions: [], input, hints: [] };
  const streamHeight = Math.max(0, height - status.length - decisions.length - input.length - hints.length - splash.length);
  const source = options.stream ?? [];
  const stream = [...source.slice(-streamHeight)];
  while (stream.length < streamHeight) stream.push("");
  return { splash, status, stream, decisions, input, hints };
}

/** Fixed status chrome rendered above the independently scrollable conversation viewport. */
export function renderStatusRegion(state: TuiShellState, width: number, height = 30, options: TuiLayoutOptions = {}): string[] {
  const frame = renderTuiLayout(state, width, height, options);
  return [...frame.splash, ...frame.status];
}

/** Compatibility wrapper for callers that still need the complete fixed chrome. */
export function renderShell(state: TuiShellState, width: number, height = 30, options: TuiLayoutOptions = {}): string[] {
  const frame = renderTuiLayout(state, width, height, options);
  return [...frame.splash, ...frame.status, ...frame.decisions];
}

/** Compatibility wrapper: the header is now a single status row. */
export function renderStatusHeader(state: TuiShellState, width: number, _height = 30): string[] {
  return [renderStatusRow(state, width)];
}

export function renderTuiFooter(width: number, state?: TuiShellState): string {
  return renderHints(state ?? {
    workspace: { cwd: "", gitRoot: "" }, connection: { kind: "connected" }, goal: { kind: "empty" }, workers: { kind: "empty" }, approvals: { kind: "empty" }, budget: { kind: "empty" },
  }, width);
}
