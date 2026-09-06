import { panelLine, type PanelState } from "./common.js";

export interface EvidenceReadModel { id: string; kind: string }
export function renderEvidencePanel(state: PanelState<readonly EvidenceReadModel[]>, width: number): string[] {
  if (state.kind === "loading") return ["Evidence", "Loading evidence…"];
  if (state.kind === "error") return ["Evidence", panelLine(`Unable to read evidence: ${state.message}`, width)];
  if (state.kind === "empty" || state.value.length === 0) return ["Evidence", "No evidence data."];
  return ["Evidence", ...state.value.map((evidence) => panelLine(`• ${evidence.id} · ${evidence.kind}`, width))];
}
