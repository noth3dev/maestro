import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Arrangements } from "./Arrangements.js";

vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.mock("../connection.js", () => ({ useConnection: () => ({ config: { apiUrl: "https://control-plane.test", token: "secret", projectId: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ selectedGoalId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("../useGoalArrangements.js", () => ({ useGoalArrangements: () => ({ arrangements: { active: [], candidates: [], encoreCouncil: [], negativeEvidence: [] }, loading: false, error: undefined }) }));

describe("Arrangements view", () => {
  it("preserves the user-facing Arrangements title and Act 3 distinction", () => {
    const html = renderToStaticMarkup(<Arrangements />);
    expect(html).toContain(">Arrangements</div>");
    expect(html).toContain("Act 3");
  });
});
