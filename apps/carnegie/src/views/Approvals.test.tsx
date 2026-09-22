import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Approvals } from "./Approvals.js";

const item = { decisionId: "33333333-3333-4333-8333-333333333333", commandId: "44444444-4444-4444-8444-444444444444", projectId: "11111111-1111-4111-8111-111111111111", goalId: "22222222-2222-4222-8222-222222222222", actorId: "operator-1", action: "deployment.release", target: "production", policyVersion: 1, budgetEffectCents: 0, classification: "critical" as const, reason: "critical_action", decidedAt: "2025-01-01T00:00:00.000Z" };

vi.mock("../icons.js", () => ({ Icon: () => null }));

describe("Approvals projection", () => {
  it("renders effect, reason, Goal/project scope, server-state expiry disclosure, and explicit controls inline", () => {
    const html = renderToStaticMarkup(<Approvals items={[item]} selectedGoalId={item.goalId} onApprove={vi.fn()} onDeny={vi.fn()} onDiscuss={vi.fn()} onRequest={vi.fn()} onSelectFullAccess={vi.fn()} />);
    expect(html).toContain("deployment.release");
    expect(html).toContain("production");
    expect(html).toContain("critical_action");
    expect(html).toContain(item.projectId);
    expect(html).toContain(item.goalId);
    expect(html).toContain("Expiry");
    expect(html).toContain("not provided by listInbox");
    expect(html).toContain("Request critical action");
    expect(html).toContain("Full-access mode");
    expect(html).toContain("explicit confirmation");
  });

  it("keeps the pending approval projection while a discussion response is present", () => {
    const html = renderToStaticMarkup(<Approvals items={[item]} discussions={[{ decisionId: item.decisionId, conversationId: "66666666-6666-4666-8666-666666666666", projectId: item.projectId, goalId: item.goalId, response: "The Concertmaster says this changes production." }]} onApprove={vi.fn()} onDeny={vi.fn()} onDiscuss={vi.fn()} />);
    expect(html).toContain("pending approval");
    expect(html).toContain("The Concertmaster says this changes production.");
    expect(html).toContain("66666666-6666-4666-8666-666666666666");
  });
});
