import { panelLine, type PanelState } from "./common.js";

export type PressureBand = "low" | "medium" | "high" | "critical";
export interface OrganizationReadModel { departments: readonly string[]; pressureBand?: PressureBand }
export function renderOrganizationPanel(state: PanelState<OrganizationReadModel>, width: number): string[] {
  if (state.kind === "loading") return ["Organization", "Loading organization…"];
  if (state.kind === "error") return ["Organization", panelLine(`Unable to read organization: ${state.message}`, width)];
  if (state.kind === "empty" || state.value.departments.length === 0) return ["Organization", "No organization data."];
  return ["Organization", ...state.value.departments.map((department) => panelLine(`• ${department}`, width))];
}
