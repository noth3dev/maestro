import type { BillingReadModel } from "@maestro/api-client";
import { panelLine, type PanelState } from "./common.js";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pluralGoals(count: number): string {
  return `${count} Goal${count === 1 ? "" : "s"}`;
}

export function renderBillingPanel(state: PanelState<BillingReadModel>, width: number): string[] {
  if (state.kind === "loading") return ["Billing", "Loading billing…"];
  if (state.kind === "error") return ["Billing", panelLine(`Unable to read billing: ${state.message}`, width)];
  if (state.kind === "empty") return ["Billing", "No billing data."];

  const { value } = state;
  const lines = [
    "Billing",
    `Daily spend · last ${value.periodDays} days · ${formatCents(value.totals.costCents)}`,
    ...value.dailySpend.map((day) => panelLine(`• ${day.date} · ${formatCents(day.costCents)}`, width)),
    `Cross-Goal totals · ${pluralGoals(value.goals.length)}`,
    panelLine(`• actual spend: ${formatCents(value.totals.costCents)}`, width),
    panelLine(`• ceiling: ${formatCents(value.totals.budgetCents)}`, width),
    panelLine(`• reserved: ${formatCents(value.totals.reservedCents)}`, width),
  ];

  lines.push("Per-department cost · unavailable", panelLine(`• ${value.departmentBreakdown.reason}`, width));
  return lines;
}
