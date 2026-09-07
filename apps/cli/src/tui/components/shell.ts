import type { Workspace } from "../workspace.js";
import { fitPlain, paintTranscript, tuiTheme, type Paint } from "../theme.js";

export type AsyncState<T> = { kind: "loading" } | { kind: "empty" } | { kind: "error"; message: string } | { kind: "value"; value: T };

export interface TuiShellState {
  workspace: Workspace;
  model?: string;
  mode?: "maestro" | "flashmob";
  connection:
    { kind: "connected" } | { kind: "connecting" } | { kind: "setup-required"; message: string } | { kind: "error"; message: string };
  goal: AsyncState<{ name: string; state: string }>;
  workers: AsyncState<number>;
  approvals: AsyncState<number>;
  budget: AsyncState<{ spentCents: number; ceilingCents: number }>;
}

const MAESTRO_LOGO = [
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠔⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡠⠊⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠔⠁⠀⠀⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⠋⠀⢀⣤⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⣀⠀⠀⠀⠀⢀⡜⠁⢀⣰⣾⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣄⠀⠀⠀⠀⢼⣿⣿⠀⢀⣴⠏⠀⠀⣾⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⡏⠀⠙⠻⣷⣄⡀⠀⠈⠉⣡⣶⡟⠁⠀⠀⠀⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⡇⠀⠀⠀⠈⢻⣿⣷⣶⣿⡿⠏⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⡇⠀⠀⠀⠀⠀⢹⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⣿⡇⠀⠀⠀⠀⠀⢸⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⡿⠿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠃⠀⠀⠀⠀⡠⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡿⠟⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
];

function stateText<T>(state: AsyncState<T>, format: (value: T) => string): string {
  if (state.kind === "loading") return "loading";
  if (state.kind === "empty") return "none";
  if (state.kind === "error") return `error: ${state.message}`;
  return format(state.value);
}

function connectionText(state: TuiShellState["connection"]): string {
  if (state.kind === "connected") return "● connected";
  if (state.kind === "connecting") return "○ connecting";
  if (state.kind === "setup-required") return `! setup required · ${state.message}`;
  return `! ${state.message}`;
}

function connectionPaint(state: TuiShellState["connection"]): Paint {
  if (state.kind === "connected") return tuiTheme.success;
  if (state.kind === "connecting") return tuiTheme.warning;
  return tuiTheme.danger;
}

function horizontalRule(width: number): string {
  return tuiTheme.border(fitPlain(`  ${"─".repeat(Math.max(0, width - 4))}`, width));
}

function splitRow(
  left: string,
  right: string,
  width: number,
  leftPaint: Paint = tuiTheme.text,
  rightPaint: Paint = tuiTheme.muted,
): string {
  const innerWidth = Math.max(0, width - 2);
  const gutter = "    ";
  const leftWidth = Math.min(50, Math.max(0, innerWidth - gutter.length));
  const rightWidth = Math.max(0, innerWidth - leftWidth - gutter.length);
  const leftText = fitPlain(left, leftWidth).padEnd(leftWidth);
  const rightText = fitPlain(right, rightWidth).padEnd(rightWidth);
  return `${tuiTheme.muted("  ")}${leftPaint(leftText)}${gutter}${rightPaint(rightText)}`;
}

function compactStatusRows(state: TuiShellState, width: number): string[] {
  const connection = connectionText(state.connection);
  const budget =
    state.budget.kind === "value"
      ? `${state.budget.value.spentCents}/${state.budget.value.ceilingCents} cents`
      : stateText(state.budget, String);
  return [
    tuiTheme.primary("  ✦ MAESTRO"),
    tuiTheme.secondary("  I AM YOUR MUZE"),
    "",
    tuiTheme.muted("  Welcome back · type / for commands · /flashmob"),
    tuiTheme.text(`  workspace  ${fitPlain(state.workspace.cwd, Math.max(0, width - 12))}`),
    tuiTheme.dim(`  git root   ${fitPlain(state.workspace.gitRoot ?? "not a Git repository", Math.max(0, width - 12))}`),
    tuiTheme.text(
      `  goal       ${fitPlain(
        stateText(state.goal, (value) => `${value.name} · ${value.state}`),
        Math.max(0, width - 12),
      )}`,
    ),
    connectionPaint(state.connection)(fitPlain(`  model      ${state.model ?? "not selected"}   ·   status  ${connection}`, width)),
    state.mode === "flashmob" ? tuiTheme.primary("  mode       flashmob") : tuiTheme.muted("  mode       maestro"),
    tuiTheme.muted(
      fitPlain(
        `  workers    ${stateText(state.workers, String)}   approvals  ${stateText(state.approvals, String)}   budget  ${budget}`,
        width,
      ),
    ),
    horizontalRule(width),
  ];
}

function wideStatusRows(state: TuiShellState, width: number): string[] {
  // Keep the mark fixed-size. Extra terminal height belongs to conversation
  // breathing room, not to the logo's source whitespace.
  // Rows 6–7 are the omitted decorative upper flourish; row 8 is the first real
  // contour and must stay visible.
  const logo = [...MAESTRO_LOGO.slice(8, 18), ...Array.from({ length: 3 }, () => " ".repeat(50))];
  const budget =
    state.budget.kind === "value"
      ? `${state.budget.value.spentCents}/${state.budget.value.ceilingCents} cents`
      : stateText(state.budget, String);
  const right = [
    "Tips for getting started",
    "Run /model list to inspect providers.",
    "Use /model use --model provider/model.",
    "Use /session new to change conversation.",
    `mode       ${state.mode === "flashmob" ? "flashmob" : "maestro"}`,
    `workspace  ${state.workspace.cwd}`,
    `git root   ${state.workspace.gitRoot ?? "not a Git repository"}`,
    `goal       ${stateText(state.goal, (value) => `${value.name} · ${value.state}`)}`,
    `model      ${state.model ?? "not selected"}`,
    `status     ${connectionText(state.connection)}`,
    `workers    ${stateText(state.workers, String)}`,
    `approvals  ${stateText(state.approvals, String)}`,
    `budget     ${budget}`,
  ];
  const rightPaints: Paint[] = [
    tuiTheme.secondary,
    tuiTheme.muted,
    tuiTheme.muted,
    tuiTheme.muted,
    state.mode === "flashmob" ? tuiTheme.primary : tuiTheme.muted,
    tuiTheme.text,
    tuiTheme.dim,
    tuiTheme.text,
    tuiTheme.text,
    connectionPaint(state.connection),
    tuiTheme.muted,
    tuiTheme.muted,
    tuiTheme.muted,
  ];
  return [
    tuiTheme.primary("  ✦ MAESTRO"),
    tuiTheme.secondary("  I AM YOUR MUZE"),
    "",
    ...logo.map((line, index) => splitRow(line, right[index] ?? "", width, tuiTheme.text, rightPaints[index] ?? tuiTheme.muted)),
    horizontalRule(width),
  ];
}

export function renderStatusHeader(state: TuiShellState, width: number, height = 30): string[] {
  if (width < 100 || height < 28) return compactStatusRows(state, width);
  return wideStatusRows(state, width);
}

export function renderShell(state: TuiShellState, width: number, height = 30): string[] {
  return [
    ...renderStatusHeader(state, width, height),
    "",
    `${tuiTheme.primary("◆")} ${tuiTheme.text("CONVERSATION")} ${tuiTheme.dim("· durable workspace dialogue")}`,
    tuiTheme.muted(fitPlain("Ask Concertmaster about the selected Goal, or type / for commands.", width)),
  ];
}

export function renderTranscript(lines: readonly string[], width: number): string[] {
  return lines.map((line) => paintTranscript(line, width));
}

export function renderTuiFooter(width: number): string {
  const content = fitPlain(
    "  ◆ model gateway  │  ctrl+k commands   ctrl+g goals   ctrl+e events   ctrl+r retry   ctrl+c cancel / exit",
    width,
  ).padEnd(Math.max(0, width));
  return tuiTheme.dim(content);
}
