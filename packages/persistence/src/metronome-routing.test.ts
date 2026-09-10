import { describe, expect, it } from "vitest";
import * as metronome from "./metronome.js";

const route = (score: number | null, status: "scored" | "unproven" = "scored") => ({
  evidenceId: "route-evidence-1",
  selectedModelRef: "provider/model",
  taskDemand: { requirements: { coding: { level: 80 } } },
  modelProfile: { capability: { axes: { coding: { status, score } } } },
  decisionLayer: "Encore Council",
});

describe("Metronome below-requirement routing", () => {
  it("detects a selected model whose durable capability is below the declared requirement", () => {
    const detector = (metronome as unknown as { detectBelowRequirementRoutingFindings?: Function }).detectBelowRequirementRoutingFindings;
    expect(typeof detector).toBe("function");
    if (typeof detector !== "function") return;
    expect(detector("goal-1", [route(79)], 1)).toEqual([expect.objectContaining({
      goalId: "goal-1", ruleId: "below_requirement_routing", evidenceIdentity: "route-evidence-1",
      details: expect.objectContaining({ selectedModelRef: "provider/model" }),
    })]);
    expect(detector("goal-1", [route(80)], 1)).toEqual([]);
    expect(detector("goal-1", [route(null, "unproven")], 1)).toHaveLength(1);
  });
});
