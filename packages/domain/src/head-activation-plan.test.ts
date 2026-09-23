import { describe, expect, it } from "vitest";
import {
  assertValidHeadActivationPlan,
  createHeadActivationPlan,
  headActivationPlanContentHash,
  type HeadActivationPlanInput,
} from "./head-activation-plan.js";

const input: HeadActivationPlanInput = {
  version: 1,
  departments: [
    {
      departmentId: "product",
      requestedContribution: "frame the product boundary",
      urgency: "normal",
      contextScope: ["task-contract", "repository"],
      budgetEffect: "no external spend",
      reason: "the launched contract requires a product boundary",
    },
  ],
};

describe("Head activation plan", () => {
  it("creates a deterministic content hash over explicit activation briefs", () => {
    const plan = createHeadActivationPlan(input);
    expect(plan.contentHash).toBe(headActivationPlanContentHash(input));
    expect(plan.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan).toEqual(
      createHeadActivationPlan({ ...input, departments: [{ ...input.departments[0]!, contextScope: ["task-contract", "repository"] }] }),
    );
  });

  it("rejects changed or duplicate department briefs at the durable boundary", () => {
    const plan = createHeadActivationPlan(input);
    expect(() => assertValidHeadActivationPlan({ ...plan, contentHash: "0".repeat(64) })).toThrow("content hash");
    expect(() => assertValidHeadActivationPlan({ ...plan, departments: [plan.departments[0]!, plan.departments[0]!] })).toThrow(
      "department",
    );
  });

  it("rejects a plan that omits an explicit activation brief", () => {
    expect(() => assertValidHeadActivationPlan({ version: 1, departments: [] })).toThrow("department");
  });
});
