import { panelLine, type PanelState } from "./common.js";

export interface IncidentReadModel { id: string; status: string }
export function renderIncidentPanel(state: PanelState<readonly IncidentReadModel[]>, width: number): string[] {
  if (state.kind === "loading") return ["Incidents", "Loading incidents…"];
  if (state.kind === "error") return ["Incidents", panelLine(`Unable to read incidents: ${state.message}`, width)];
  if (state.kind === "empty" || state.value.length === 0) return ["Incidents", "No incidents data."];
  return ["Incidents", ...state.value.map((incident) => panelLine(`• ${incident.id} · ${incident.status}`, width))];
}
