import { describe, expect, it } from "vitest";
import { detectBelowRequirementRoutingFindings } from "./metronome.js";

const route = (score: number | null, status: "scored" | "unproven" = "scored") => ({
  evidenceId: "route-evidence-1",
  selectedModelRef: "provider/model",
  taskDemand: { requirements: { coding: { level: 80 } } },
  modelProfile: { capability: { axes: { coding: { status, score } } } },
  decisionLayer: "Encore Council",
});

describe("Metronome below-requirement routing", () => {
  it("detects a selected model whose durable capability is below the declared requirement", () => {
    expect(detectBelowRequirementRoutingFindings("goal-1", [route(79)], 1)).toEqual([expect.objectContaining({
      goalId: "goal-1", ruleId: "below_requirement_routing", evidenceIdentity: "route-evidence-1",
      details: expect.objectContaining({ selectedModelRef: "provider/model" }),
    })]);
    expect(detectBelowRequirementRoutingFindings("goal-1", [route(80)], 1)).toEqual([]);
    expect(detectBelowRequirementRoutingFindings("goal-1", [route(null, "unproven")], 1)).toHaveLength(1);
    expect(() => detectBelowRequirementRoutingFindings("goal-1", [{ evidenceId: "malformed-route" }], 1)).toThrow("Routing evidence is malformed");
  });
});
