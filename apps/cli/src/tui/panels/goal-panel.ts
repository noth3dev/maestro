import type { GoalResult } from "@maestro/api-client";
import { panelLine, type PanelState } from "./common.js";

export function renderGoalPanel(state: PanelState<readonly Pick<GoalResult, "goalId" | "projectId" | "state" | "version">[]>, width: number): string[] {
  if (state.kind === "loading") return ["Goals", "Loading goals…"];
  if (state.kind === "error") return ["Goals", panelLine(`Unable to read goals: ${state.message}`, width)];
  if (state.kind === "empty" || state.value.length === 0) return ["Goals", "No goals found."];
  return ["Goals", ...state.value.map((goal) => panelLine(`• ${goal.goalId} · ${goal.state} · v${goal.version}`, width))];
}
