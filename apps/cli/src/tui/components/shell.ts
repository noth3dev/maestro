import type { Workspace } from "../workspace.js";

export type AsyncState<T> =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "value"; value: T };

export interface TuiShellState {
  workspace: Workspace;
  connection: { kind: "connected" } | { kind: "connecting" } | { kind: "setup-required"; message: string } | { kind: "error"; message: string };
  goal: AsyncState<{ name: string; state: string }>;
  workers: AsyncState<number>;
  approvals: AsyncState<number>;
  budget: AsyncState<{ spentCents: number; ceilingCents: number }>;
}

function stateText<T>(state: AsyncState<T>, format: (value: T) => string): string {
  if (state.kind === "loading") return "loading";
  if (state.kind === "empty") return "none";
  if (state.kind === "error") return `error: ${state.message}`;
  return format(state.value);
}

export function renderStatusHeader(state: TuiShellState, width: number): string[] {
  const connection = state.connection.kind === "connected" ? "● connected" : state.connection.kind === "connecting" ? "○ connecting" : state.connection.kind === "setup-required" ? `! setup required · ${state.connection.message}` : `! ${state.connection.message}`;
  const budget = state.budget.kind === "value" ? `${state.budget.value.spentCents}/${state.budget.value.ceilingCents} cents` : stateText(state.budget, String);
  const lines = [
    `MAESTRO / CONCERTMASTER · ${connection}`,
    `Workspace: ${state.workspace.cwd}`,
    `Git root: ${state.workspace.gitRoot ?? "not a Git repository"}`,
    `Goal: ${stateText(state.goal, (value) => `${value.name} · ${value.state}`)}`,
    `Workers: ${stateText(state.workers, String)} · Approvals: ${stateText(state.approvals, String)} · Budget: ${budget}`,
  ];
  return lines.map((line) => line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`);
}

export function renderShell(state: TuiShellState, width: number): string[] {
  return [
    ...renderStatusHeader(state, width),
    "",
    "Concertmaster",
    "",
    "> ",
    "",
    "Ctrl+K Commands · Ctrl+G Goals · Ctrl+E Events · Ctrl+R Retry · Ctrl+C Exit",
  ];
}
