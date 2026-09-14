import type { EncoreCouncilRoundList } from "@maestro/api-client";
import { panelLine, type PanelState } from "./common.js";

type Round = EncoreCouncilRoundList["rounds"][number];

export function renderEncorePanel(state: PanelState<readonly Round[]>, width: number): string[] {
  if (state.kind === "loading") return ["Encore", "Loading Encore rounds…"];
  if (state.kind === "error") return ["Encore", panelLine(`Unable to read Encore rounds: ${state.message}`, width)];
  if (state.kind === "empty" || state.value.length === 0) return ["Encore", "No Encore rounds found."];
  const lines: string[] = [];
  for (const round of state.value) {
    lines.push(`• ${round.roundId} · ${round.question}`, `  criteria: ${round.criteria.map((criterion) => `${criterion.criterionId}: ${criterion.description}`).join("; ") || "none"}`, `  evidence: ${round.evidenceIds.join(", ") || "none"}`, `  triggers: ${round.triggerReasons.join(", ") || "none"}`, `  reviewers: ${round.reviewerCount}`);
    for (const judgment of round.judgments) lines.push(`  judgment ${judgment.modelProvider}/${judgment.modelId}: ${judgment.verdict} (${judgment.confidence}) · reasoning: ${judgment.reasoning} · conditions: ${judgment.conditions.join(", ") || "none"} · dissent: ${judgment.dissentNote ?? "none"}`);
    lines.push(`  final verdict: ${round.synthesis.finalVerdict} · same model only: ${round.synthesis.sameModelOnly} · escalated: ${round.synthesis.escalated}`, `  dissent notes: ${round.synthesis.dissentNotes.join("; ") || "none"}`);
  }
  return ["Encore", ...lines.map((line) => panelLine(line, width))];
}
