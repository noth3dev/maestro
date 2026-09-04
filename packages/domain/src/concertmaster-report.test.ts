import { describe, expect, it } from "vitest";
import { evaluateCertificationCompleteness, type CertificationRecordFact } from "./concertmaster-report.js";

const record = (overrides: Partial<CertificationRecordFact> = {}): CertificationRecordFact => ({
  kind: "quality", verdict: "passed", contractId: "c1", contractVersion: 1, integratedCommitSha: "a".repeat(40), hasUnwaivedCriticalFinding: false,
  ...overrides,
});

describe("Certification completeness gate", () => {
  it("has no blockers when the single required certification passes cleanly", () => {
    const blockers = evaluateCertificationCompleteness({ requiredKinds: ["quality"], records: [record()], openChallengeCount: 0 });
    expect(blockers).toHaveLength(0);
  });
  it("blocks when a required certification is missing", () => {
    const blockers = evaluateCertificationCompleteness({ requiredKinds: ["quality", "security"], records: [record()], openChallengeCount: 0 });
    expect(blockers.some((b) => b.reason === "missing_required_certification")).toBe(true);
  });
  it("blocks when a required certification's verdict is not passed", () => {
    const blockers = evaluateCertificationCompleteness({ requiredKinds: ["quality"], records: [record({ verdict: "failed" })], openChallengeCount: 0 });
    expect(blockers.some((b) => b.reason === "certification_verdict_not_passed")).toBe(true);
  });
  it("blocks on an unwaived critical finding even if the verdict claims passed", () => {
    const blockers = evaluateCertificationCompleteness({ requiredKinds: ["quality"], records: [record({ hasUnwaivedCriticalFinding: true })], openChallengeCount: 0 });
    expect(blockers.some((b) => b.reason === "unwaived_critical_finding")).toBe(true);
  });
  it("blocks when required certifications bind to different Contract identities or commits", () => {
    const blockers = evaluateCertificationCompleteness({
      requiredKinds: ["quality", "security"],
      records: [record({ kind: "quality" }), record({ kind: "security", integratedCommitSha: "b".repeat(40) })],
      openChallengeCount: 0,
    });
    expect(blockers.some((b) => b.reason === "certification_identity_mismatch")).toBe(true);
  });
  it("blocks on any unresolved Metronome challenge", () => {
    const blockers = evaluateCertificationCompleteness({ requiredKinds: ["quality"], records: [record()], openChallengeCount: 1 });
    expect(blockers.some((b) => b.reason === "unresolved_challenge")).toBe(true);
  });
  it("does not consider certifications for kinds that are not required", () => {
    const blockers = evaluateCertificationCompleteness({
      requiredKinds: ["quality"],
      records: [record({ kind: "quality" }), record({ kind: "security", verdict: "failed", integratedCommitSha: "b".repeat(40) })],
      openChallengeCount: 0,
    });
    expect(blockers).toHaveLength(0);
  });

  it("requires successful workers, durable acceptance, and a frozen integration revision", () => {
    const blockers = evaluateCertificationCompleteness({
      requiredKinds: ["quality"],
      records: [record()],
      openChallengeCount: 0,
      hasFrozenIntegratedRevision: false,
      workers: [{ workerId: "worker-1", status: "running", hasDepartmentAcceptance: false, acceptanceBoundToIntegratedRevision: false }],
    });
    expect(blockers.map((blocker) => blocker.reason)).toEqual(expect.arrayContaining([
      "missing_integrated_revision", "worker_execution_not_succeeded", "missing_department_acceptance", "unverifiable_integrated_revision",
    ]));
  });

  it("requires certification records to match the current contract hash and integration revision", () => {
    const blockers = evaluateCertificationCompleteness({
      requiredKinds: ["quality"],
      records: [record({ contractContentHash: "b".repeat(64), integrationRevisionId: "old-revision" })],
      expectedContractId: "c1",
      expectedContractVersion: 1,
      expectedContractContentHash: "c".repeat(64),
      expectedIntegrationRevisionId: "new-revision",
      expectedIntegratedCommitSha: "a".repeat(40),
      openChallengeCount: 0,
    });
    expect(blockers.some((blocker) => blocker.reason === "certification_identity_mismatch")).toBe(true);
  });

  it("blocks success when actual spend exceeds the Goal budget", () => {
    const blockers = evaluateCertificationCompleteness({
      requiredKinds: [], records: [], openChallengeCount: 0,
      actualCostCents: 101, budgetCents: 100,
    });
    expect(blockers).toEqual([{ reason: "budget_exceeded", detail: "Actual cost 101 cents exceeds the Goal budget 100 cents" }]);
  });

  it("does not let a newest certification hide an unresolved conflict", () => {
    const blockers = evaluateCertificationCompleteness({
      requiredKinds: ["quality"],
      records: [record()],
      openChallengeCount: 0,
      unresolvedCertificationConflict: true,
    });
    expect(blockers.some((blocker) => blocker.reason === "unresolved_certification_conflict")).toBe(true);
  });
});
