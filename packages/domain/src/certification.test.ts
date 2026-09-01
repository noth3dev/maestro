import { describe, expect, it } from "vitest";
import { assertValidDepartmentAcceptanceSubstance, assertValidQualityCertificationSubstance, InvalidCertificationError, type QualityCertificationSubstance } from "./certification.js";

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
