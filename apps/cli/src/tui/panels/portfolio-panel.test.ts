import { describe, expect, it } from "vitest";
import { renderPortfolioPanel } from "./portfolio-panel.js";

describe("portfolio panel", () => {
  it("renders active capacity", () => {
    expect(renderPortfolioPanel({ kind: "value", value: { activeGoals: 2, capacity: 4 } }, 80)).toEqual(["Portfolio", "• active goals: 2/4"]);
  });
});
