import type { ImprovementCandidateKind, ImprovementCandidateMetricGuard, ImprovementCandidateRollbackTarget } from "./improvement-candidate.js";

export type ImprovementClass = ImprovementCandidateKind;
export type RolloutProtectedMetric = Pick<ImprovementCandidateMetricGuard, "name" | "minimum" | "maximum">;

export interface RolloutScope {
  readonly roleId: string;
  readonly taskClass: string;
  readonly maxGoalCount: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface RolloutMetricObservation {
  readonly name: string;
  readonly value: number;
}

export interface RolloutMetricDecision {
  readonly decision: "continue" | "rollback";
  readonly violatedMetrics: readonly string[];
}

export interface InterruptedRolloutState {
  readonly status: "interrupted";
  readonly activeCandidateId: string;
  readonly activeVersion: number;
  readonly lastCertifiedCandidateId: string;
  readonly lastCertifiedVersion: number;
  readonly rollbackTarget: ImprovementCandidateRollbackTarget;
}

export class InvalidRolloutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRolloutError";
  }
}

export function assertImprovementClassEnabled(improvementClass: ImprovementClass, enabledClasses: readonly ImprovementClass[]): void {
  if (improvementClass !== "persona_axis" && improvementClass !== "routing_capability_axis") throw new InvalidRolloutError("Improvement class is invalid");
  if (!enabledClasses.includes(improvementClass)) throw new InvalidRolloutError(`Improvement class is not explicitly enabled: ${improvementClass}`);
}

export function assertBoundedRolloutScope(scope: RolloutScope): RolloutScope {
  if (!scope || typeof scope !== "object") throw new InvalidRolloutError("Rollout scope is required");
  for (const [name, value] of [["roleId", scope.roleId], ["taskClass", scope.taskClass]] as const) {
    if (typeof value !== "string" || value.trim() === "" || value.length > 256 || /[\r\n]/.test(value)) throw new InvalidRolloutError(`Rollout ${name} scope is invalid`);
  }
  if (!Number.isSafeInteger(scope.maxGoalCount) || scope.maxGoalCount < 1 || scope.maxGoalCount > 1000) throw new InvalidRolloutError("Rollout max goal count must be bounded");
  const start = Date.parse(scope.windowStart);
  const end = Date.parse(scope.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new InvalidRolloutError("Rollout time window is invalid");
  if (end - start > 31 * 24 * 60 * 60 * 1000) throw new InvalidRolloutError("Rollout time window exceeds the bounded limit");
  return Object.freeze({ ...scope });
}

export function evaluateProtectedMetrics(protectedMetrics: readonly RolloutProtectedMetric[], observations: readonly RolloutMetricObservation[]): RolloutMetricDecision {
  if (!Array.isArray(protectedMetrics) || protectedMetrics.length === 0) throw new InvalidRolloutError("Rollout protected metrics are required");
  if (!Array.isArray(observations)) throw new InvalidRolloutError("Rollout metric observations are required");
  const byName = new Map<string, number>();
  for (const observation of observations) {
    if (!observation || typeof observation.name !== "string" || observation.name.trim() === "" || !Number.isFinite(observation.value) || byName.has(observation.name)) throw new InvalidRolloutError("Rollout metric observation is invalid or duplicated");
    byName.set(observation.name, observation.value);
  }
  const violatedMetrics: string[] = [];
  for (const metric of protectedMetrics) {
    if (!metric || typeof metric.name !== "string" || metric.name.trim() === "" || (!Number.isFinite(metric.minimum) && !Number.isFinite(metric.maximum))) throw new InvalidRolloutError("Rollout protected metric is invalid");
    const value = byName.get(metric.name);
    if (value === undefined || (metric.minimum !== undefined && value < metric.minimum) || (metric.maximum !== undefined && value > metric.maximum)) violatedMetrics.push(metric.name);
  }
  return Object.freeze({ decision: violatedMetrics.length === 0 ? "continue" : "rollback", violatedMetrics: Object.freeze(violatedMetrics) });
}

export function reconcileInterruptedRollout(state: InterruptedRolloutState): {
  readonly status: "rolled_back";
  readonly activeCandidateId: string;
  readonly activeVersion: number;
  readonly rollbackTarget: ImprovementCandidateRollbackTarget;
} {
  if (!state || state.status !== "interrupted") throw new InvalidRolloutError("Only an interrupted rollout can be reconciled");
  if (state.lastCertifiedCandidateId !== state.rollbackTarget.candidateId || state.lastCertifiedVersion !== state.rollbackTarget.version) throw new InvalidRolloutError("Interrupted rollout rollback target is not the last certified state");
  return Object.freeze({ status: "rolled_back", activeCandidateId: state.rollbackTarget.candidateId, activeVersion: state.rollbackTarget.version, rollbackTarget: Object.freeze({ ...state.rollbackTarget }) });
}
