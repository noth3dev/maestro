import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GoalPage, loadGoalPageData } from "./goal-page.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const token = "local-operator-secret";
const config = { apiUrl: "http://127.0.0.1:4310", token, projectId, goalId };

describe("Secretary Goal page", () => {
  it("uses the typed API client and renders the exact durable Goal state from the control plane", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ goalId, projectId, state: "paused", version: 7 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        events: [{ cursor: "9", eventId: "33333333-3333-4333-8333-333333333333", projectId, goalId, aggregateVersion: "7", eventType: "GoalPaused", schemaVersion: 1, payload: { evidenceId: "evidence-42" }, occurredAt: "2026-09-01T00:00:00.000Z" }],
        nextCursor: "9",
      }), { status: 200 }));

    const data = await loadGoalPageData(config, fetch);
    const html = renderToStaticMarkup(<GoalPage data={data} />);

    expect(fetch).toHaveBeenNthCalledWith(1, `http://127.0.0.1:4310/v1/goals/${goalId}?projectId=${projectId}`, expect.objectContaining({ headers: { authorization: `Bearer ${token}` } }));
    expect(fetch).toHaveBeenNthCalledWith(2, `http://127.0.0.1:4310/v1/events?projectId=${projectId}&after=0`, expect.objectContaining({ headers: { authorization: `Bearer ${token}` } }));
    expect(html).toContain("paused");
    expect(html).toContain("Version 7");
    expect(html).toContain("GoalPaused");
    expect(html).toContain("evidence-42");
  });

  it("renders clear empty history and error states", () => {
    expect(renderToStaticMarkup(<GoalPage data={{ goal: { goalId, projectId, state: "draft", version: 0 }, events: [] }} />)).toContain("No durable events yet.");
    expect(renderToStaticMarkup(<GoalPage error="Control plane request failed" />)).toContain("Unable to load Goal");
  });
});
