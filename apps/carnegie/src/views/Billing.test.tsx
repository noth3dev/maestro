import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Billing, BillingStateNotice } from "./Billing.js";

vi.mock("../components/EmptyState.js", () => ({ EmptyState: ({ title, hint }: { title?: string; hint?: string }) => <div>{title} {hint}</div> }));
vi.mock("../connection.js", () => ({
  useConnection: () => ({ config: { apiUrl: "https://control-plane.test", projectId: "11111111-1111-4111-8111-111111111111" }, loading: false, connect: vi.fn(), disconnect: vi.fn(), reportSessionFailure: vi.fn() }),
}));
vi.mock("../goals.js", () => ({ useGoals: () => ({ selectedGoalId: undefined }) }));

describe("Billing view", () => {
  it("renders distinct no-Goal and no-billing states", () => {
    const html = renderToStaticMarkup(<BillingStateNotice goalSelected={false} budgetLoading={false} budgetError={undefined} budgetStale={false} budget={undefined} billing={undefined} billingLoading={false} billingError={undefined} billingStale={false} />);
    expect(html).toContain("No Goal selected");
    expect(html).toContain("No billing record");
  });

  it("renders provider errors and preserves stale server values", () => {
    const budget = { goalId: "11111111-1111-4111-8111-111111111111", projectId: "11111111-1111-4111-8111-111111111111", budgetCents: 100, reservedCents: 20, costCents: 10 };
    const html = renderToStaticMarkup(<BillingStateNotice goalSelected={true} budgetLoading={false} budgetError="provider unavailable" budgetStale={true} budget={budget} billing={undefined} billingLoading={false} billingError="billing unavailable" billingStale={false} />);
    expect(html).toContain("provider unavailable");
    expect(html).toContain("Showing the last saved budget");
    expect(html).toContain("billing unavailable");
  });

  it("labels department costs unavailable instead of rendering invented breakdown data", () => {
    const html = renderToStaticMarkup(<Billing />);
    expect(html).toContain("per-department cost");
    expect(html).toContain("unavailable");
    expect(html).not.toContain("Engineering");
    expect(html).not.toContain("Product");
  });
});
