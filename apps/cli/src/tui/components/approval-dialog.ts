import type { ApprovalDialogEffect, ApprovalDialogSummary, CriticalActionSummary } from "../confirmation.js";
import { panelLine } from "../panels/common.js";

function legacy(summary: CriticalActionSummary, width: number): string[] {
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

function effectLine(effect: ApprovalDialogEffect): string {
  const marker = effect.setsTier ? "   ← sets the tier" : "";
  const arrow = effect.setsTier ? "→ " : "  ";
  return `${arrow}${effect.classification}   ${effect.action}   ${effect.target}${marker}`;
}

function scopeLine(scope: NonNullable<ApprovalDialogSummary["repetitionScope"]>): string {
  const labels: Record<NonNullable<ApprovalDialogSummary["repetitionScope"]>, string> = {
    once: "once",
    bounded_count: "bounded count",
    bounded_time: "bounded time",
    bounded_budget: "bounded budget",
    session: "this session",
  };
  return `Scope  [·] ${labels[scope]}   [ ] 5 more   [ ] this session`;
}

export function renderApprovalDialog(summary: ApprovalDialogSummary, width: number): string[] {
  if (summary.tier === undefined || summary.effects === undefined || summary.repetitionScope === undefined || summary.saferAlternative === undefined) return legacy(summary, width);
  const effects = summary.effects;
  const lines = [
    `Approval required · ${summary.tier}`,
    "─────────────────────────────────────────────────",
    `This block contains ${effects.length} effects. Highest tier wins.`,
    "",
    ...effects.map(effectLine),
    "",
    ...(summary.pressure === undefined || summary.pressureBand === undefined ? [] : [`Pressure  ${summary.pressure} (${summary.pressureBand}) · ${summary.tier}`]),
    `Tier set by ${summary.tierTrigger}`,
    ...(summary.fullAccessMode === "skip_intermediate_approvals" && summary.tier === "user" ? ["Tier 4 user approval remains required"] : []),
    scopeLine(summary.repetitionScope),
    `Reject: ${summary.saferAlternative}`,
    "─────────────────────────────────────────────────",
    "y approve · n reject (proposes safer alternative) · ? why",
  ];
  return lines.map((line) => panelLine(line, width));
}
