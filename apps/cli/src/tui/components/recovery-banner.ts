import { panelLine } from "../panels/common.js";
import type { RecoverySummary } from "../recovery.js";

export function renderRecoveryBanner(summary: RecoverySummary, width: number): string[] {
  if (summary.kind === "new") return ["Session", panelLine(summary.message, width)];
  if (summary.kind === "unavailable") return ["Session unavailable", panelLine(summary.message, width)];
  if (summary.kind === "stale") return ["Recovery required", panelLine(`Project: ${summary.projectId} · Goal: ${summary.goalId ?? "none"} · State: ${summary.goalState}`, width), panelLine(`Active workers: ${summary.activeWorkers === undefined ? "unknown" : summary.activeWorkers}`, width), "TUI exit does not cancel server-owned work."];
  return ["Session attached", panelLine(`Project: ${summary.projectId} · Event cursor: ${summary.lastEventCursor ?? "0"}`, width), "TUI exit does not cancel server-owned work."];
}
