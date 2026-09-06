import { panelLine, type PanelState } from "./common.js";

export interface PortfolioReadModel { activeGoals: number; capacity: number }
export function renderPortfolioPanel(state: PanelState<PortfolioReadModel>, width: number): string[] {
  if (state.kind === "loading") return ["Portfolio", "Loading portfolio…"];
  if (state.kind === "error") return ["Portfolio", panelLine(`Unable to read portfolio: ${state.message}`, width)];
  if (state.kind === "empty") return ["Portfolio", "No portfolio data."];
  return ["Portfolio", panelLine(`• active goals: ${state.value.activeGoals}/${state.value.capacity}`, width)];
}
