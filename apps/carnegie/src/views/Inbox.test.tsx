import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Inbox } from "./Inbox.js";

vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.mock("../components/EmptyState.js", () => ({ EmptyState: ({ title }: { title?: string }) => <div>{title ?? "empty"}</div> }));
vi.mock("../connection.js", () => ({
  useConnection: () => ({ config: { apiUrl: "https://control-plane.test", token: "credential.secret", projectId: "11111111-1111-4111-8111-111111111111" }, loading: false, connect: vi.fn(), disconnect: vi.fn() }),
}));
vi.mock("../useGoalDetail.js", () => ({ useGoalDetail: () => ({ detail: undefined, loading: false, error: undefined, refresh: vi.fn() }) }));

describe("Inbox view", () => {
  it("renders durable pending approval actions and Concertmaster discussion affordance", () => {
    const html = renderToStaticMarkup(<Inbox onNavigate={vi.fn()} />);
    expect(html).toContain("Pending approvals across visible Goals; certifications for the selected Goal.");
    expect(html).not.toContain("Pending critical-action approvals aren't listable here yet");
  });
});
