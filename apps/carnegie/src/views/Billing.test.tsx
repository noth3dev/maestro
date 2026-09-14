import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Billing } from "./Billing.js";

vi.mock("../components/EmptyState.js", () => ({ EmptyState: ({ title, hint }: { title?: string; hint?: string }) => <div>{title} {hint}</div> }));
vi.mock("../connection.js", () => ({
  useConnection: () => ({ config: { apiUrl: "https://control-plane.test", projectId: "11111111-1111-4111-8111-111111111111" }, loading: false, connect: vi.fn(), disconnect: vi.fn() }),
}));
vi.mock("../useGoalDetail.js", () => ({ useGoalDetail: () => ({ detail: undefined, loading: false, error: undefined, refresh: vi.fn() }) }));

describe("Billing view", () => {
  it("labels department costs unavailable instead of rendering invented breakdown data", () => {
    const html = renderToStaticMarkup(<Billing />);
    expect(html).toContain("per-department cost");
    expect(html).toContain("unavailable");
    expect(html).not.toContain("Engineering");
    expect(html).not.toContain("Product");
  });
});
