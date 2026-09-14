import type { HeadCouncil } from "@maestro/contracts";
import { panelLine, type PanelState } from "./common.js";

function json(value: unknown): string { return JSON.stringify(value); }
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

export function renderCouncilPanel(state: PanelState<HeadCouncil>, width: number): string[] {
  if (state.kind === "loading") return ["Council", "Loading Council…"];
  if (state.kind === "error") return ["Council", panelLine(`Unable to read Council: ${state.message}`, width)];
  if (state.kind === "empty") return ["Council", "No Council data."];
  const council = state.value;
  const snapshot = object(council.snapshot);
  const participants = snapshot?.participants;
  const lines = [
    `• ${council.councilId} · ${council.state}`,
    `goal: ${council.goalId}`,
    `contract: ${council.contractId}`,
    `brief deadline: ${council.briefDeadline}`,
    `no-new-evidence streak: ${council.noNewEvidenceStreak}`,
    `snapshot hash: ${council.snapshotHash}`,
  ];
  if (snapshot === undefined) lines.push("snapshot payload: unavailable");
  else {
    lines.push("snapshot payload:");
    for (const [key, value] of Object.entries(snapshot)) lines.push(`  ${key}: ${json(value)}`);
  }
  if (Array.isArray(participants) && participants.length > 0) {
    lines.push("participants:");
    for (const participant of participants) lines.push(`  ${json(participant)}`);
  } else lines.push("No Council participants are present in the route response.");
  if (council.decisionPacket === null) lines.push("decision packet: unavailable");
  else lines.push(`decision packet: ${json(council.decisionPacket)}`);
  lines.push("Briefs unavailable from Head Council route response.");
  return ["Council", ...lines.map((line) => panelLine(line, width))];
}
