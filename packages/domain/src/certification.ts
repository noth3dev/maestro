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

export type ConditionalCertificationKind = "security" | "safety_compliance";

/**
 * "Security and Safety & Compliance participate when risk requires them" --
 * these are deterministic risk triggers from real Task Contract and Council
 * decision facts, not a blanket requirement on every Goal.
 */
export interface ConditionalCertificationRiskFacts {
  readonly criticalActionExpectations: readonly string[];
  readonly criticalActions: readonly string[];
  readonly externalServiceAssumptions: readonly string[];
  readonly dataBoundary: string;
}

export function requiredConditionalCertifications(facts: ConditionalCertificationRiskFacts): readonly ConditionalCertificationKind[] {
  const kinds: ConditionalCertificationKind[] = [];
  const hasCriticalAction = facts.criticalActionExpectations.length > 0 || facts.criticalActions.length > 0;
  const hasExternalService = facts.externalServiceAssumptions.some((assumption) => assumption.trim().toLowerCase() !== "none");
  if (hasCriticalAction || hasExternalService) kinds.push("security");
  const hasBroadDataBoundary = !["local", "repository files only"].includes(facts.dataBoundary.trim().toLowerCase());
  if (hasCriticalAction || hasBroadDataBoundary) kinds.push("safety_compliance");
  return kinds;
}

/** Certifications conflict when any required verdict disagrees with any other (a mix of "passed" with "failed"/"blocked"). */
export function certificationsConflict(verdicts: readonly QualityVerdict[]): boolean {
  const distinct = new Set(verdicts);
  return distinct.has("passed") && (distinct.has("failed") || distinct.has("blocked"));
}

export interface WaiverSubstance {
  readonly authority: string;
  readonly reason: string;
  readonly consequence: string;
  readonly followUp: string;
  readonly expiresAt: Date;
}

export class InvalidWaiverError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidWaiverError"; }
}

/**
 * "A waived noncritical finding must record authority, reason, consequence,
 * expiry, and follow-up. Critical safety or correctness findings cannot be
 * waived merely to close the Goal." The critical-severity check happens
 * where the actual finding is loaded (the persistence layer); this
 * validator enforces the required substance fields and that expiry is
 * genuinely in the future, not a rubber-stamped past date.
 */
function waiverText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new InvalidWaiverError(`${field} is required`);
}

export function assertValidWaiverSubstance(value: WaiverSubstance, now: Date = new Date()): void {
  waiverText(value.authority, "Waiver authority");
  waiverText(value.reason, "Waiver reason");
  waiverText(value.consequence, "Waiver consequence");
  waiverText(value.followUp, "Waiver followUp");
  if (!(value.expiresAt instanceof Date) || Number.isNaN(value.expiresAt.getTime()) || value.expiresAt.getTime() <= now.getTime()) {
    throw new InvalidWaiverError("Waiver expiresAt must be a real future date");
  }
}
