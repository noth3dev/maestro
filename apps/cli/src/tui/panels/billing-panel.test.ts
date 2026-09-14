import { describe, expect, it } from "vitest";
import type { BillingReadModel } from "@maestro/api-client";
import { renderBillingPanel } from "./billing-panel.js";

const billing: BillingReadModel = {
  projectId: "11111111-1111-4111-8111-111111111111",
  periodDays: 14,
  dailySpend: Array.from({ length: 14 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, costCents: index === 13 ? 1000 : 0 })),
  goals: [
    { goalId: "22222222-2222-4222-8222-222222222222", budgetCents: 3000, reservedCents: 500, costCents: 125 },
    { goalId: "33333333-3333-4333-8333-333333333333", budgetCents: 7000, reservedCents: 1200, costCents: 875 },
  ],
  totals: { budgetCents: 10000, reservedCents: 1700, costCents: 1000 },
  departmentBreakdown: { available: false, reason: "Actual costs are tracked at Goal scope only" },
};

describe("billing panel", () => {
  it("renders the shared daily history, per-department state, and cross-Goal totals", () => {
    expect(renderBillingPanel({ kind: "value", value: billing }, 120)).toEqual([
      "Billing",
      "Daily spend · last 14 days · $10.00",
      ...billing.dailySpend.map((day) => `• ${day.date} · $${(day.costCents / 100).toFixed(2)}`),
      "Cross-Goal totals · 2 Goals",
      "• actual spend: $10.00",
      "• ceiling: $100.00",
      "• reserved: $17.00",
      "Goals",
      "• 22222222-2222-4222-8222-222222222222 · budget $30.00 · reserved $5.00 · actual $1.25",
      "• 33333333-3333-4333-8333-333333333333 · budget $70.00 · reserved $12.00 · actual $8.75",
      "Per-department cost · unavailable",
      "• Actual costs are tracked at Goal scope only",
    ]);
  });

  it("does not fabricate billing data while unavailable", () => {
    expect(renderBillingPanel({ kind: "error", message: "offline" }, 80)).toEqual(["Billing", "Unable to read billing: offline"]);
  });
});
