import type { TaskContract } from "@maestro/api-client";
import { panelLine, type PanelState } from "./common.js";

function value(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function renderTaskContractPanel(state: PanelState<TaskContract>, width: number): string[] {
  if (state.kind === "loading") return ["Task Contract", "Loading Task Contract…"];
  if (state.kind === "error") return ["Task Contract", panelLine(`Unable to read Task Contract: ${state.message}`, width)];
  if (state.kind === "empty") return ["Task Contract", "No Task Contract data."];
  const contract = state.value;
  const lines = [
    `• ${contract.contractId} · ${contract.launchState} · v${contract.version}`,
    `schema version: ${contract.schemaVersion}`,
    `content hash: ${contract.contentHash}`,
    "substance:",
  ];
  for (const [key, entry] of Object.entries(contract)) {
    if (["contractId", "schemaVersion", "version", "contentHash", "launchState", "decisionHistory"].includes(key)) continue;
    lines.push(`  ${key}: ${value(entry)}`);
  }
  lines.push("version history:");
  if (contract.decisionHistory.length === 0) lines.push("  No version history recorded.");
  else for (const decision of contract.decisionHistory) lines.push(`  ${decision.kind} · ${decision.decisionId} · ${value(decision.evidence)}`);
  return ["Task Contract", ...lines.map((line) => panelLine(line, width))];
}
