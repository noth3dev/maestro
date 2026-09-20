import { fitPlain, tuiTheme } from "../theme.js";

export interface MainPageContext {
  pendingDecisions: readonly { tier: string; action: string; actor: string }[];
}

export type MainPageState =
  | { viewId: string; kind: "loading" }
  | { viewId: string; kind: "error"; message: string }
  | { viewId: string; kind: "inbox" }
  | { viewId: string; kind: "read"; title: string; lines: readonly string[] };

const LABELS: Record<string, string> = {
  inbox: "inbox",
  channel: "channel",
  evlog: "evidence log",
  billing: "billing",
  luthiery: "luthiery",
};

const SUBTITLES: Record<string, string> = {
  inbox: "pending approvals · operator response required",
  channel: "Goal-bound channels · durable messages only",
  evlog: "durable events and certified work for the selected Goal",
  billing: "project billing rollup · selected Goal context",
  luthiery: "skills and tools · durable registry status",
};

function labelFor(viewId: string): string {
  return LABELS[viewId] ?? viewId;
}

function line(value: string, width: number): string {
  return tuiTheme.text(fitPlain(value, width));
}

/** Render a destination-specific main pane without changing command semantics. */
export function renderMainPage(viewId: string, state: MainPageState, context: MainPageContext, width: number): string[] {
  if (width <= 0) return [];
  const label = labelFor(viewId);
  const body = [tuiTheme.primary(fitPlain(label, width)), tuiTheme.muted(fitPlain(SUBTITLES[viewId] ?? "", width)), ""];

  if (state.kind === "loading") return [...body, line(`Loading ${label}…`, width)];
  if (state.kind === "error") return [...body, line(`Unable to load ${label}:`, width), line(state.message, width)];
  if (state.kind === "inbox") {
    return [
      ...body,
      ...(context.pendingDecisions.length === 0
        ? [line("No pending approvals.", width)]
        : context.pendingDecisions.map((decision) => line(`⏸ ${decision.tier} · ${decision.action} · ${decision.actor}`, width))),
    ];
  }
  return [...body, tuiTheme.primary(fitPlain(state.title, width)), ...state.lines.map((value) => line(value, width))];
}
