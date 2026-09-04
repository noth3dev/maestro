export type MetronomeRuleId =
  | "stale_worker_superseded_plan"
  | "worker_missing_plan_item"
  | "missing_evidence_reference";

/** A finding is deduplicated by (goalId, ruleId, evidenceIdentity, planVersion) -- a durable, stable key, not a random id. */
export interface MetronomeFinding {
  readonly goalId: string;
  readonly ruleId: MetronomeRuleId;
  readonly evidenceIdentity: string;
  readonly planVersion: number;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface WorkerPlanFact {
  readonly workerId: string;
  readonly departmentId: string;
  readonly planVersion: number;
  readonly itemId: string;
}

/** A worker is stale once its Department's Plan has been revised past the version it was spawned against. */
export function detectStaleWorkerFindings(goalId: string, currentPlanVersionByDepartment: ReadonlyMap<string, number>, workers: readonly WorkerPlanFact[]): readonly MetronomeFinding[] {
  const findings: MetronomeFinding[] = [];
  for (const worker of workers) {
    const currentVersion = currentPlanVersionByDepartment.get(worker.departmentId);
    if (currentVersion !== undefined && worker.planVersion < currentVersion) {
      findings.push({
        goalId, ruleId: "stale_worker_superseded_plan", evidenceIdentity: worker.workerId, planVersion: currentVersion,
        details: { workerId: worker.workerId, departmentId: worker.departmentId, workerPlanVersion: worker.planVersion, currentPlanVersion: currentVersion },
      });
    }
  }
  return findings;
}

/** A worker whose assigned item no longer exists in the Department's current Plan (removed by a later revision) is doing work without an active plan item. */
export function detectMissingPlanItemFindings(goalId: string, currentPlanItemsByDepartment: ReadonlyMap<string, { readonly version: number; readonly itemIds: ReadonlySet<string> }>, workers: readonly WorkerPlanFact[]): readonly MetronomeFinding[] {
  const findings: MetronomeFinding[] = [];
  for (const worker of workers) {
    const current = currentPlanItemsByDepartment.get(worker.departmentId);
    if (current !== undefined && worker.planVersion === current.version && !current.itemIds.has(worker.itemId)) {
      findings.push({
        goalId, ruleId: "worker_missing_plan_item", evidenceIdentity: worker.workerId, planVersion: current.version,
        details: { workerId: worker.workerId, departmentId: worker.departmentId, itemId: worker.itemId },
      });
    }
  }
  return findings;
}

/** An evidence reference recorded as durable evidence for this Goal that does not actually resolve to a durable evidence record is missing or corrupt. */
export function detectMissingEvidenceFindings(goalId: string, planVersion: number, referencedEvidenceIds: readonly string[], durableEvidenceIds: ReadonlySet<string>): readonly MetronomeFinding[] {
  const findings: MetronomeFinding[] = [];
  const seen = new Set<string>();
  for (const reference of referencedEvidenceIds) {
    const trimmed = reference.trim();
    if (trimmed === "" || seen.has(trimmed) || durableEvidenceIds.has(trimmed)) continue;
    seen.add(trimmed);
    findings.push({
      goalId, ruleId: "missing_evidence_reference", evidenceIdentity: trimmed, planVersion,
      details: { reference: trimmed },
    });
  }
  return findings;
}
