import { panelLine } from "./common.js";

export type LuthieryRegistry = "skills" | "tools";

export type LuthieryPanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "unavailable"; registry: LuthieryRegistry };

const unavailableReason = (registry: LuthieryRegistry): string =>
  `The control plane does not durably track ${registry} definitions, tags, certification state, or usage counts yet.`;

export function renderLuthieryPanel(state: LuthieryPanelState, width: number): string[] {
  if (state.kind === "loading") return ["Luthiery", "Loading registry…"];
  if (state.kind === "error") return ["Luthiery", panelLine(`Unable to read luthiery registry: ${state.message}`, width)];
  if (state.kind === "empty") return ["Luthiery", "No durable registry is available."];
  return ["Luthiery", `${state.registry} registry unavailable`, panelLine(unavailableReason(state.registry), width)];
}
