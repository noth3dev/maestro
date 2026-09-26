import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar.js";

const goalsState = vi.hoisted(() => ({ goals: undefined as readonly { goalId: string; state: string }[] | undefined, orchestrationByGoalId: {} as Record<string, { stage: string; state: string }>, selectedGoalId: undefined as string | undefined, selectGoal: vi.fn() }));

vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.mock("../i18n/index.js", () => ({
  useT: () => ({
    nav: { concertmaster: "concertmaster", newSession: "new session", untitledSession: "untitled session", inbox: "inbox", dashboard: "dashboard", planning: "planning", flashmob: "flashmob", floor: "floor view", evidenceLog: "evidence log", billing: "billing", luthiery: "luthiery", arrangements: "arrangements" },
  }),
}));
vi.mock("../theme.js", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("../goals.js", () => ({ useGoals: () => goalsState }));
vi.mock("../connection.js", () => ({ useConnection: () => ({ config: undefined }) }));
vi.mock("../sessions.js", () => ({ useSessions: () => ({ sessions: [], activeConversationId: undefined, openSession: vi.fn(), newSessionRequest: 0, refresh: vi.fn() }) }));
vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
vi.stubGlobal("React", React);

describe("Sidebar navigation semantics", () => {
  it("shows a durable orchestration stage when one exists for a Goal", () => {
    const goalId = "22222222-2222-4222-8222-222222222222";
    goalsState.goals = [{ goalId, state: "active" }]; goalsState.selectedGoalId = goalId; goalsState.orchestrationByGoalId = { [goalId]: { stage: "briefs_pending", state: "running" } };
    const html = renderToStaticMarkup(<Sidebar view="dashboard" onNavigate={vi.fn()} />);
    expect(html).toContain("briefs_pending");
    goalsState.goals = undefined; goalsState.selectedGoalId = undefined; goalsState.orchestrationByGoalId = {};
  });

  it("marks only the current route as the current page", () => {
    const html = renderToStaticMarkup(<Sidebar view="home" onNavigate={vi.fn()} />);

    expect(html).toContain('aria-label="Primary navigation"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('class="sb-item on" aria-current="page"');
  });
});
