import type { MetronomeChallengeList } from "@maestro/api-client";
import { panelLine, type PanelState } from "./common.js";

type Challenge = MetronomeChallengeList["challenges"][number];

export function renderMetronomePanel(state: PanelState<readonly Challenge[]>, width: number): string[] {
  if (state.kind === "loading") return ["Metronome", "Loading Metronome challenges…"];
  if (state.kind === "error") return ["Metronome", panelLine(`Unable to read Metronome challenges: ${state.message}`, width)];
  if (state.kind === "empty" || state.value.length === 0) return ["Metronome", "No challenges found."];
  const lines: string[] = [];
  for (const challenge of state.value) {
    lines.push(`• ${challenge.challengeId} · ${challenge.status}`, `  reason: ${challenge.reason}`, `  evidence: ${challenge.evidenceReferences.join(", ") || "none"}`, `  correction: ${challenge.correctionRequest ?? "none"}`, `  target: ${challenge.targetRef ?? "none"}`, `  raised by: ${challenge.raisedBy} · resolved by: ${challenge.resolvedBy ?? "none"}${challenge.resolutionReason === null ? "" : ` · ${challenge.resolutionReason}`}`);
  }
  lines.push("Findings unavailable from challenge-list route response.");
  return ["Metronome", ...lines.map((line) => panelLine(line, width))];
}
