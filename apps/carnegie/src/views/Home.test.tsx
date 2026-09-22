import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Home } from "./Home.js";

vi.mock("../connection.js", () => ({ useConnection: () => ({ config: { projectId: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ selectedGoalId: undefined }) }));
vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.stubGlobal("React", React);

describe("Home Concertmaster conversation", () => {
  it("keeps the initial composer focused before a conversation exists", () => {
    const html = renderToStaticMarkup(<Home onNavigate={vi.fn()} mode="maestro" onModeChange={vi.fn()} />);
    expect(html).toContain("Brief the Concertmaster");
    expect(html).not.toContain("conversation not started");
    expect(html).not.toContain("continue conversation");
    expect(html).not.toContain("retry turn");
    expect(html).not.toContain("cancel turn");
  });
});
