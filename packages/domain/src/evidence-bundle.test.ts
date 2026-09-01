import { describe, expect, it } from "vitest";
import { assertEvidenceBundleIntegrity, evidenceBundleContentHash, EvidenceBundleIntegrityError, type EvidenceBundle } from "./evidence-bundle.js";

const bundle: Omit<EvidenceBundle, "assembledAt"> = {
  goalId: "goal-1", taskContract: { contractId: "c1" }, council: { councilId: "co1" }, departmentPlans: [], workers: [],
  gitIntegration: {}, certifications: {}, sentinelFindings: [], sentinelChallenges: [], overwatchRounds: [], budgetReservations: [],
};

describe("Evidence bundle integrity", () => {
  it("hashes canonically regardless of key order", () => {
    const reordered = { ...bundle, goalId: bundle.goalId };
    expect(evidenceBundleContentHash(bundle)).toBe(evidenceBundleContentHash(reordered));
  });
  it("verifies a matching hash without throwing", () => {
    expect(() => assertEvidenceBundleIntegrity(bundle, evidenceBundleContentHash(bundle))).not.toThrow();
  });
  it("rejects a bundle whose content does not match the recorded hash", () => {
    const tampered = { ...bundle, workers: [{ workerId: "injected" }] };
    expect(() => assertEvidenceBundleIntegrity(tampered, evidenceBundleContentHash(bundle))).toThrow(EvidenceBundleIntegrityError);
  });
});
