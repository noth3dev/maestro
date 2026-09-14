import type { GoalBudgetSummary } from "@maestro/api-client";
import { panelLine, type PanelState } from "./common.js";

export function renderBudgetPanel(state: PanelState<GoalBudgetSummary>, width: number): string[] {
  if (state.kind === "loading") return ["Budget", "Loading budget…"];
  if (state.kind === "error") return ["Budget", panelLine(`Unable to read budget: ${state.message}`, width)];
  if (state.kind === "empty") return ["Budget", "No budget data."];
  const budget = state.value;
  return ["Budget", ...[`• ${budget.goalId}`, `envelope: ${budget.budgetCents} cents`, `reserved: ${budget.reservedCents} cents`, `spent: ${budget.costCents} cents`, "Forecast unavailable from GoalBudgetSummary route response.", "Department breakdown unavailable from GoalBudgetSummary route response."].map((line) => panelLine(line, width))];
}
