import { describe, expect, it } from "vitest";
import { assertValidDepartmentAcceptanceSubstance, assertValidQualityCertificationSubstance, InvalidCertificationError, requiredConditionalCertifications, type QualityCertificationSubstance } from "./certification.js";

describe("Certification substances", () => {
  it("accepts a valid Department acceptance", () => {
    expect(() => assertValidDepartmentAcceptanceSubstance({ reason: "tests pass and diff reviewed" })).not.toThrow();
  });
  it("rejects a blank acceptance reason", () => {
    expect(() => assertValidDepartmentAcceptanceSubstance({ reason: "" })).toThrow(InvalidCertificationError);
  });

  const base: QualityCertificationSubstance = { verdict: "passed", findings: [], testEvidenceIds: ["ev-1"] };
  it("accepts a valid passed certification with test evidence and no critical findings", () => {
    expect(() => assertValidQualityCertificationSubstance(base)).not.toThrow();
  });
  it("rejects a passed verdict with no test evidence (green output alone is not certification)", () => {
    expect(() => assertValidQualityCertificationSubstance({ ...base, testEvidenceIds: [] })).toThrow(InvalidCertificationError);
  });
  it("rejects a passed verdict carrying a critical finding (cannot be waived to close the Goal)", () => {
    expect(() => assertValidQualityCertificationSubstance({ ...base, findings: [{ findingId: "f1", severity: "critical", description: "security hole" }] })).toThrow(InvalidCertificationError);
  });
  it("allows a passed verdict alongside a noncritical finding", () => {
    expect(() => assertValidQualityCertificationSubstance({ ...base, findings: [{ findingId: "f1", severity: "noncritical", description: "minor style issue" }] })).not.toThrow();
  });
  it("allows a failed verdict with no test evidence", () => {
    expect(() => assertValidQualityCertificationSubstance({ verdict: "failed", findings: [], testEvidenceIds: [] })).not.toThrow();
  });
});


describe("Conditional certification risk triggers", () => {
  const noRisk = { criticalActionExpectations: [], criticalActions: [], externalServiceAssumptions: ["none"], dataBoundary: "repository files only" };
  it("requires no conditional certification for a routine local-only Goal", () => {
    expect(requiredConditionalCertifications(noRisk)).toHaveLength(0);
  });
  it("requires Security when a critical action is expected", () => {
    expect(requiredConditionalCertifications({ ...noRisk, criticalActionExpectations: ["deploy"] })).toContain("security");
  });
  it("requires Security when an external service is assumed", () => {
    expect(requiredConditionalCertifications({ ...noRisk, externalServiceAssumptions: ["payment-gateway"] })).toContain("security");
  });
  it("requires Safety & Compliance when the data boundary is broader than local", () => {
    expect(requiredConditionalCertifications({ ...noRisk, dataBoundary: "customer PII" })).toContain("safety_compliance");
  });
  it("requires both when a critical action is present", () => {
    const kinds = requiredConditionalCertifications({ ...noRisk, criticalActions: ["irreversible delete"] });
    expect(kinds).toContain("security");
    expect(kinds).toContain("safety_compliance");
  });
});
