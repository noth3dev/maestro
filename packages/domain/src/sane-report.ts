export type CertificationCompletenessBlockerReason =
  | "missing_required_certification"
  | "certification_verdict_not_passed"
  | "certification_identity_mismatch"
  | "unwaived_critical_finding"
  | "missing_department_acceptance"
  | "worker_execution_not_succeeded"
  | "missing_integrated_revision"
  | "unverifiable_integrated_revision"
  | "unresolved_certification_conflict"
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
  /** The hash is part of the contract identity, not an optional display field. */
  readonly contractContentHash?: string;
  readonly integratedCommitSha: string;
  /** The immutable Goal revision row that the certification actually examined. */
  readonly integrationRevisionId?: string | null;
  readonly certificationId?: string;
  readonly hasUnwaivedCriticalFinding: boolean;
}

export interface WorkerExecutionFact {
  readonly workerId: string;
  readonly status: string;
  readonly hasDepartmentAcceptance: boolean;
  readonly acceptanceBoundToIntegratedRevision: boolean;
}

export interface CertificationCompletenessFacts {
  readonly requiredKinds: readonly ("quality" | "security" | "safety_compliance")[];
  readonly records: readonly CertificationRecordFact[];
  readonly openChallengeCount: number;
  /** Current Task Contract identity expected by this report. */
  readonly expectedContractId?: string;
  readonly expectedContractVersion?: number;
  readonly expectedContractContentHash?: string;
  /** Current immutable Goal integration revision expected by this report. */
  readonly expectedIntegrationRevisionId?: string;
  readonly expectedIntegratedCommitSha?: string;
  readonly hasFrozenIntegratedRevision?: boolean;
  /** These facts are intentionally separate from certification records. */
  readonly workers?: readonly WorkerExecutionFact[];
  readonly unresolvedCertificationConflict?: boolean;
}

/**
 * Sane's gate requires independent sources of truth: successful durable worker
 * execution and Department acceptance, a frozen Goal integration revision, and
 * certifications bound to the current Contract and that revision. Completion
 * percentage and worker self-report are deliberately not inputs.
 */
export function evaluateCertificationCompleteness(facts: CertificationCompletenessFacts): readonly CertificationCompletenessBlocker[] {
  const blockers: CertificationCompletenessBlocker[] = [];
  const expectedIdentity = facts.expectedContractId === undefined
    ? undefined
    : `${facts.expectedContractId}:${facts.expectedContractVersion ?? ""}:${facts.expectedContractContentHash ?? ""}:${facts.expectedIntegrationRevisionId ?? ""}:${facts.expectedIntegratedCommitSha ?? ""}`;

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
    if (expectedIdentity !== undefined) {
      const actualIdentity = `${record.contractId}:${record.contractVersion}:${record.contractContentHash ?? ""}:${record.integrationRevisionId ?? ""}:${record.integratedCommitSha}`;
      if (actualIdentity !== expectedIdentity) blockers.push({ reason: "certification_identity_mismatch", detail: `${kind} certification is not bound to the current Task Contract and Goal integration revision` });
    }
  }

  const identities = new Set(facts.records
    .filter((record) => facts.requiredKinds.includes(record.kind))
    .map((record) => `${record.contractId}:${record.contractVersion}:${record.contractContentHash ?? ""}:${record.integrationRevisionId ?? ""}:${record.integratedCommitSha}`));
  if (identities.size > 1) {
    blockers.push({ reason: "certification_identity_mismatch", detail: "Required certifications do not all bind to the same Task Contract identity and integrated revision" });
  }

  if (facts.hasFrozenIntegratedRevision === false) {
    blockers.push({ reason: "missing_integrated_revision", detail: "No frozen integrated revision exists for this Goal" });
  }
  if (facts.workers !== undefined) {
    if (facts.workers.length === 0) blockers.push({ reason: "worker_execution_not_succeeded", detail: "No worker execution is durably recorded for this Goal" });
    for (const worker of facts.workers) {
      if (worker.status !== "succeeded") blockers.push({ reason: "worker_execution_not_succeeded", detail: `Worker ${worker.workerId} did not durably succeed (status: ${worker.status})` });
      if (!worker.hasDepartmentAcceptance) blockers.push({ reason: "missing_department_acceptance", detail: `Worker ${worker.workerId} has no durable Department acceptance` });
      if (!worker.acceptanceBoundToIntegratedRevision) blockers.push({ reason: "unverifiable_integrated_revision", detail: `Worker ${worker.workerId}'s accepted commit is not included in the frozen Goal integration revision` });
    }
  }
  if (facts.unresolvedCertificationConflict === true) {
    blockers.push({ reason: "unresolved_certification_conflict", detail: "Conflicting certifications have no durable Council resolution for the current Goal revision" });
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
