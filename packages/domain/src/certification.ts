export class InvalidCertificationError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidCertificationError"; }
}

export interface DepartmentAcceptanceSubstance {
  readonly reason: string;
}

export type QualityVerdict = "passed" | "failed" | "blocked";

export interface QualityFinding {
  readonly findingId: string;
  readonly severity: "critical" | "noncritical";
  readonly description: string;
}

export interface QualityCertificationSubstance {
  readonly verdict: QualityVerdict;
  readonly findings: readonly QualityFinding[];
  readonly testEvidenceIds: readonly string[];
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidCertificationError(`${field} is required`);
}

export function assertValidDepartmentAcceptanceSubstance(value: DepartmentAcceptanceSubstance): void {
  text(value.reason, "Department acceptance reason");
}

export function assertValidQualityCertificationSubstance(value: QualityCertificationSubstance): void {
  if (!["passed", "failed", "blocked"].includes(value.verdict)) throw new InvalidCertificationError("Quality certification verdict is invalid");
  for (const finding of value.findings) {
    if (!["critical", "noncritical"].includes(finding.severity)) throw new InvalidCertificationError("Quality finding severity is invalid");
    text(finding.description, "Quality finding description");
  }
  // "A worker's green test output is evidence, not final certification": a
  // passed verdict must still be grounded in independently run test evidence.
  if (value.verdict === "passed" && value.testEvidenceIds.length === 0) {
    throw new InvalidCertificationError("A passed Quality certification requires independently run test evidence");
  }
  // "Critical safety or correctness findings cannot be waived merely to
  // close the Goal": a critical finding can never coexist with a passed verdict.
  if (value.verdict === "passed" && value.findings.some((finding) => finding.severity === "critical")) {
    throw new InvalidCertificationError("A passed Quality certification cannot carry an unresolved critical finding");
  }
}
