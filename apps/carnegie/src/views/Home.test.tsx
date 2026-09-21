import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Home } from "./Home.js";

vi.mock("../connection.js", () => ({ useConnection: () => ({ config: { projectId: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ selectedGoalId: undefined }) }));
vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.stubGlobal("React", React);

describe("Home Concertmaster conversation", () => {
  it("makes the real conversation identity, turn state, and continuation path visible", () => {
    const html = renderToStaticMarkup(<Home onNavigate={vi.fn()} mode="maestro" onModeChange={vi.fn()} />);
    expect(html).toContain("conversation");
    expect(html).toContain("continue conversation");
    expect(html).toContain("turn");
  });
});
