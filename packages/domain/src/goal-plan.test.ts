import { describe, expect, it } from "vitest";
import { assertValidGoalPlan, goalPlanContentHash, type GoalPlanSubstance } from "./goal-plan.js";

const plan: GoalPlanSubstance = {
  phases: [
    { phaseNo: 1, title: "Sign-up page", outcome: "Visitors can subscribe" },
    { phaseNo: 2, title: "Launch", outcome: "Page is live" },
  ],
  slices: [
    { sliceId: "p1s1", phaseNo: 1, departmentId: "design", title: "Page mock", objective: "Final mock", acceptance: ["Approved mock"], dependsOn: [] },
    { sliceId: "p1s2", phaseNo: 1, departmentId: "engineering", title: "Form", objective: "Build form", acceptance: ["Form submits"], dependsOn: ["p1s1"] },
    { sliceId: "p2s1", phaseNo: 2, departmentId: "infrastructure", title: "Deploy", objective: "Deploy", acceptance: ["Reachable URL"], dependsOn: ["p1s2"] },
  ],
};

describe("goal plan", () => {
  it("accepts phases with department-owned p<phase>s<n> slices", () => {
    expect(() => assertValidGoalPlan(plan)).not.toThrow();
    expect(goalPlanContentHash(plan)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects bad numbering, unknown phases or dependencies, and cycles", () => {
    const withSlices = (slices: GoalPlanSubstance["slices"]) => ({ ...plan, slices });
    expect(() => assertValidGoalPlan(withSlices([{ ...plan.slices[0]!, sliceId: "s1" }]))).toThrow("not a p<phase>s<n>");
    expect(() => assertValidGoalPlan(withSlices([{ ...plan.slices[0]!, sliceId: "p2s9" }]))).toThrow("does not belong to phase 1");
    expect(() => assertValidGoalPlan(withSlices([{ ...plan.slices[0]!, sliceId: "p3s1", phaseNo: 3 }]))).toThrow("unknown phase 3");
    expect(() => assertValidGoalPlan(withSlices([{ ...plan.slices[0]!, dependsOn: ["p9s9"] }]))).toThrow("unknown slice p9s9");
    expect(() => assertValidGoalPlan(withSlices([{ ...plan.slices[0]!, acceptance: [] }]))).toThrow("acceptance must be a list");
    expect(() =>
      assertValidGoalPlan(
        withSlices([
          { ...plan.slices[0]!, dependsOn: ["p1s2"] },
          { ...plan.slices[1]!, dependsOn: ["p1s1"] },
        ]),
      ),
    ).toThrow("cycle");
  });
});
