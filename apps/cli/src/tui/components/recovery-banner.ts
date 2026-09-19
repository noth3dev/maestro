import { panelLine } from "../panels/common.js";
import { fitPlain } from "../theme.js";
import type { RecoverySummary } from "../recovery.js";

export function renderRecoveryBanner(summary: RecoverySummary, width: number): string[] {
  if (summary.kind === "new") return ["Session", panelLine(summary.message, width)];
  if (summary.kind === "unavailable") return ["Session unavailable", panelLine(summary.message, width)];
  if (summary.kind === "stale") return ["Recovery required", panelLine(`Project: ${summary.projectId} · Goal: ${summary.goalId ?? "none"} · State: ${summary.goalState}`, width), panelLine(`Active workers: ${summary.activeWorkers === undefined ? "unknown" : summary.activeWorkers}`, width), panelLine("TUI exit does not cancel server-owned work.", width)];
  return ["Session attached", panelLine(`Project: ${summary.projectId} · Event cursor: ${summary.lastEventCursor ?? "0"}`, width), panelLine("TUI exit does not cancel server-owned work.", width)];
}

export function renderBlockedSetupPanel(summary: Extract<RecoverySummary, { kind: "new" }>, width: number): string[] {
  const panelWidth = Math.min(72, Math.max(4, width));
  const innerWidth = Math.max(0, panelWidth - 4);
  const body = [
    "Setup required",
    summary.message,
    "Set MAESTRO_API_URL + MAESTRO_API_TOKEN; restart",
    "Or enable local autostart; restart",
  ];
  const border = `╭${"─".repeat(Math.max(0, panelWidth - 2))}╮`;
  const bottom = `╰${"─".repeat(Math.max(0, panelWidth - 2))}╯`;
  const content = body.map((line) => `│ ${fitPlain(line, innerWidth).padEnd(innerWidth)} │`);
  const left = " ".repeat(Math.max(0, Math.floor((width - panelWidth) / 2)));
  return [border, ...content, bottom].map((line) => `${left}${line}`);
}
