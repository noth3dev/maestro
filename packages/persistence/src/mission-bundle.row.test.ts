import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { listMissionBundlesForPlan, MissionBundleError } from "./mission-bundle.js";

const legacySubstance = {
  role: "execution", profileRef: "profile-1", goalBrief: "implement safely",
  approvedModels: ["test/model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/product"],
  environment: ["node24"], authorityBoundary: ["bounded"], externalServiceBoundary: ["none"], dataBoundary: ["repository"],
  costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
  deliverable: "a patch", evidenceRequirements: ["tests"], validationCriteria: ["tests pass"], terminationConditions: ["complete"],
};

function row(substance: unknown) {
  return {
    bundle_id: "bundle-1", council_id: "council-1", department_id: "product", plan_version: 1,
    plan_content_hash: "a".repeat(64), item_id: "exec-1", parent_ref: "head:product:council-1",
    substance, content_hash: "b".repeat(64),
  };
}

describe("stored Mission Bundle list validation", () => {
  it("fails closed instead of returning a legacy row without TaskDemand", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [row(legacySubstance)] }) } as unknown as Pool;
    await expect(listMissionBundlesForPlan(pool, "council-1", "product", 1)).rejects.toBeInstanceOf(MissionBundleError);
  });
});
