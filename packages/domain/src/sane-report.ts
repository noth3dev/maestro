export type CertificationCompletenessBlockerReason =
  | "missing_required_certification"
  | "certification_verdict_not_passed"
  | "certification_identity_mismatch"
  | "unwaived_critical_finding"
  | "unresolved_challenge";

export interface CertificationCompletenessBlocker {
  readonly reason: CertificationCompletenessBlockerReason;
  readonly detail: string;
}

export interface CertificationRecordFact {
  readonly kind: "quality" | "security" | "safety_compliance";
  readonly verdict: "passed" | "failed" | "blocked";
  readonly contractId: string;
  readonly contractVersion: number;
  readonly integratedCommitSha: string;
  readonly hasUnwaivedCriticalFinding: boolean;
}

export interface CertificationCompletenessFacts {
  readonly requiredKinds: readonly ("quality" | "security" | "safety_compliance")[];
  readonly records: readonly CertificationRecordFact[];
  readonly openChallengeCount: number;
}

/**
 * "Sane reports success only when all required certifications bind to the
 * same Task Contract identity and integrated revision." "Do not report
 * success from completion percentage or worker self-report." This
 * evaluator looks at nothing except real certification records and open
 * challenges -- no plan-item completion count or worker-reported status is
 * an input here, by construction.
 */
export function evaluateCertificationCompleteness(facts: CertificationCompletenessFacts): readonly CertificationCompletenessBlocker[] {
  const blockers: CertificationCompletenessBlocker[] = [];
  for (const kind of facts.requiredKinds) {
    const record = facts.records.find((candidate) => candidate.kind === kind);
    if (record === undefined) {
      blockers.push({ reason: "missing_required_certification", detail: `Missing required ${kind} certification` });
      continue;
    }
    if (record.verdict !== "passed") {
      blockers.push({ reason: "certification_verdict_not_passed", detail: `${kind} certification verdict is ${record.verdict}` });
    }
    if (record.hasUnwaivedCriticalFinding) {
      blockers.push({ reason: "unwaived_critical_finding", detail: `${kind} certification has an unwaived critical finding` });
    }
  }
  const identities = new Set(facts.records.filter((record) => facts.requiredKinds.includes(record.kind)).map((record) => `${record.contractId}:${record.contractVersion}:${record.integratedCommitSha}`));
  if (identities.size > 1) {
    blockers.push({ reason: "certification_identity_mismatch", detail: "Required certifications do not all bind to the same Task Contract identity and integrated revision" });
  }
  if (facts.openChallengeCount > 0) {
    blockers.push({ reason: "unresolved_challenge", detail: `${facts.openChallengeCount} unresolved Sentinel challenge(s)` });
  }
  return blockers;
}

export interface SaneFinalReportSubstance {
  readonly ceoRequest: string;
  readonly whatChanged: string;
  readonly userVisibleBehaviorPassed: boolean;
  readonly participatingDepartments: readonly string[];
  readonly keyDecisions: readonly string[];
  readonly dissent: readonly string[];
  readonly independentValidation: readonly string[];
  readonly costCents: number;
  readonly budgetCents: number;
  readonly incidents: readonly string[];
  readonly knownLimitations: readonly string[];
  readonly criticalActionAwaitingApproval: boolean;
}
