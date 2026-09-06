import type { CriticalActionSummary } from "../confirmation.js";
import { panelLine } from "../panels/common.js";

export function renderApprovalDialog(summary: CriticalActionSummary, width: number): string[] {
  return [
    "Approval required",
    panelLine(`Action: ${summary.action}`, width),
    panelLine(`Target: ${summary.target}`, width),
    ...(summary.goalId === undefined ? [] : [panelLine(`Goal: ${summary.goalId}`, width)]),
    panelLine(`Effect: ${summary.effect}`, width),
    panelLine(`Expires: ${summary.expiresAt}`, width),
    "Press y to approve · n to cancel",
  ];
}
