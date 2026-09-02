import { describe, expect, it } from "vitest";
import { assertEvidenceBundleIntegrity, evidenceBundleContentHash, EvidenceBundleIntegrityError, type EvidenceBundle } from "./evidence-bundle.js";
import { canonicalJson } from "./task-contract.js";

const bundle: Omit<EvidenceBundle, "assembledAt"> = {
  goalId: "goal-1", taskContract: { contractId: "c1" }, council: { councilId: "co1" }, departmentPlans: [], departmentPlanRevisions: [], workers: [],
  gitIntegration: {}, certifications: {}, sentinelFindings: [], sentinelChallenges: [], overwatchRounds: [], budgetReservations: [], evidenceRecords: [],
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

  it("canonicalizes Date values as ISO strings so persisted evidence hashes survive a read", () => {
    const resolvedAt = new Date("2026-09-01T22:00:00.000Z");
    expect(canonicalJson({ resolvedAt })).toBe('{"resolvedAt":"2026-09-01T22:00:00.000Z"}');
    const recorded = { ...bundle, sentinelFindings: [{ findingId: "finding-1", resolvedAt }] };
    const persisted = JSON.parse(JSON.stringify(recorded)) as typeof recorded;
    expect(evidenceBundleContentHash(recorded)).toBe(evidenceBundleContentHash(persisted));
  });
});
