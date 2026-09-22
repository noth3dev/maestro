import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar.js";

vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.mock("../i18n/index.js", () => ({
  useT: () => ({
    nav: { search: "search", inbox: "inbox", dashboard: "dashboard", planning: "planning", flashmob: "flashmob", floor: "floor view", evidenceLog: "evidence log", billing: "billing", luthiery: "luthiery", arrangements: "arrangements" },
  }),
}));
vi.mock("../theme.js", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ goals: undefined, selectedGoalId: undefined, selectGoal: vi.fn() }) }));
vi.mock("../connection.js", () => ({ useConnection: () => ({ config: undefined }) }));
vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
vi.stubGlobal("React", React);

describe("Sidebar navigation semantics", () => {
  it("marks only the current route as the current page", () => {
    const html = renderToStaticMarkup(<Sidebar view="home" onNavigate={vi.fn()} />);

    expect(html).toContain('aria-label="Primary navigation"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('class="sb-item on" aria-current="page"');
  });
});
