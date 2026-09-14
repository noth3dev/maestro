import type { DepartmentPlan } from "@maestro/contracts";
import { panelLine, type PanelState } from "./common.js";

function json(value: unknown): string { return JSON.stringify(value); }

export function renderDepartmentPlanPanel(state: PanelState<DepartmentPlan>, width: number): string[] {
  if (state.kind === "loading") return ["Department Plan", "Loading Department Plan…"];
  if (state.kind === "error") return ["Department Plan", panelLine(`Unable to read Department Plan: ${state.message}`, width)];
  if (state.kind === "empty") return ["Department Plan", "No Department Plan data."];
  const plan = state.value;
  const lines = [`• ${plan.councilId}/${plan.departmentId} · v${plan.version}`, `content hash: ${plan.contentHash}`, `contribution: ${plan.substance.contribution}`, `items: ${plan.substance.items.map((item) => `${item.itemId} (${item.kind}) · ${item.objective}`).join("; ")}`, `handoffs: ${json(plan.substance.requiredHandoffs)}`, `validation: ${json(plan.substance.validationCriteria)}`, "Revision history unavailable from Department Plan route response."];
  return ["Department Plan", ...lines.map((line) => panelLine(line, width))];
}
