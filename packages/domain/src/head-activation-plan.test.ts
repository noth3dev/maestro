import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assertValidHeadActivationPlan,
  createHeadActivationPlan,
  deriveCouncilCreationCommandId,
  deriveHeadActivationCommandId,
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

  it("derives stable command identities compatible with persisted start_goal retries", () => {
    const startCommandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const councilId = deriveCouncilCreationCommandId(startCommandId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const headId = deriveHeadActivationCommandId(startCommandId, "product");

    expect(councilId).toBe("1d4f18b5-d34d-527d-ad66-1dfe80c87fb0");
    expect(headId).toBe("bf98cee7-d8f8-5be8-9ce6-a00ef6a65556");
    expect(councilId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(headId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(councilId).toBe(deriveCouncilCreationCommandId(startCommandId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    expect(headId).toBe(deriveHeadActivationCommandId(startCommandId, "product"));
    expect(councilId).not.toBe(deriveCouncilCreationCommandId(startCommandId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
    expect(headId).not.toBe(deriveHeadActivationCommandId(startCommandId, "security"));
  });

  it("keeps the shared domain module free of Node-only crypto imports", async () => {
    const source = await readFile(new URL("./head-activation-plan.ts", import.meta.url), "utf8");
    expect(source).not.toContain('from "node:crypto"');
  });
});
