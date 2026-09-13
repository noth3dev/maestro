import {
  assertValidImprovementCandidateInput,
  improvementCandidateScenarioSuiteHash,
  type ImprovementCandidateInput,
} from "./improvement-candidate.js";

export interface CandidateEvaluationMetrics {
  readonly correctness: number;
  readonly safety: number;
  readonly authority: number;
  readonly cost: number;
  readonly [metric: string]: number;
}

export interface DeterministicCandidateGuardContext {
  readonly roleFloors?: Readonly<Record<string, number>>;
  readonly roleCeilings?: Readonly<Record<string, number>>;
  readonly mandatoryScenarioIds?: readonly string[];
  readonly baselineProfile?: Readonly<Record<string, number>>;
  readonly existingProfiles?: readonly Readonly<Record<string, number>>[];
  /** False when the proposed profile is known to collapse Council diversity. */
  readonly diversityPreserved?: boolean;
}

export interface DeterministicCandidateGuardResult {
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

const CORE_IDENTITY_OR_AUTHORITY_AXES = new Set(["authority", "core_identity", "core-identity", "safety_boundary", "truthfulness"]);

export function runDeterministicCandidateGuards(
  value: unknown,
  context: DeterministicCandidateGuardContext = {},
): DeterministicCandidateGuardResult {
  const reasons: string[] = [];
  try {
    assertValidImprovementCandidateInput(value);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "candidate input is invalid");
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Partial<ImprovementCandidateInput>;
    if (Array.isArray(candidate.changes)) {
      for (const change of candidate.changes) {
        if (!change || typeof change !== "object") continue;
        const item = change as { axis?: unknown; proposedValue?: unknown };
        const axis = typeof item.axis === "string" ? item.axis : "unknown";
        if (CORE_IDENTITY_OR_AUTHORITY_AXES.has(axis.toLowerCase())) reasons.push("candidate changes core identity or authority");
        if (typeof item.proposedValue === "number") {
          const floor = context.roleFloors?.[axis];
          const ceiling = context.roleCeilings?.[axis];
          if (floor !== undefined && item.proposedValue < floor) reasons.push(`${axis} violates its role floor`);
          if (ceiling !== undefined && item.proposedValue > ceiling) reasons.push(`${axis} violates its role ceiling`);
        }
      }
    }
    if (context.mandatoryScenarioIds?.some((scenarioId) => !Array.isArray(candidate.scenarioSuite) || !candidate.scenarioSuite.includes(scenarioId))) {
      reasons.push("candidate removes mandatory challenge or escalation behavior");
    }
    if (context.baselineProfile && context.existingProfiles && Array.isArray(candidate.changes)) {
      const proposedProfile = { ...context.baselineProfile };
      for (const change of candidate.changes) {
        if (change && typeof change === "object" && typeof (change as { axis?: unknown }).axis === "string" && typeof (change as { proposedValue?: unknown }).proposedValue === "number") {
          proposedProfile[(change as { axis: string }).axis] = (change as { proposedValue: number }).proposedValue;
        }
      }
      const keys = Object.keys(proposedProfile);
      if (context.existingProfiles.some((profile) => keys.length === Object.keys(profile).length && keys.every((key) => profile[key] === proposedProfile[key]))) {
        reasons.push("candidate creates a known duplicate profile and reduces Council diversity");
      }
    }
  }
  if (context.diversityPreserved === false) reasons.push("candidate reduces Council diversity");
  return { passed: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export interface ReplayGoalInput {
  readonly goalId: string;
  readonly input: unknown;
  readonly baseline: CandidateEvaluationMetrics;
}

export interface ReplayRequest {
  readonly scenarioSuite: readonly string[];
  readonly guards?: DeterministicCandidateGuardContext;
  readonly goals: readonly ReplayGoalInput[];
  readonly evaluate: (input: unknown, candidate: ImprovementCandidateInput) => CandidateEvaluationMetrics;
}

export interface ReplayComparison {
  readonly goalId: string;
  readonly baseline: CandidateEvaluationMetrics;
  readonly candidate: CandidateEvaluationMetrics;
}

export type ReplayResult =
  | { readonly status: "compared"; readonly scenarioSuiteHash: string; readonly results: readonly ReplayComparison[] }
  | { readonly status: "invalidated"; readonly reason: string }
  | { readonly status: "rejected"; readonly reason: string };

export function replayCandidateAgainstFrozenBaseline(candidate: ImprovementCandidateInput, request: ReplayRequest): ReplayResult {
  const guards = runDeterministicCandidateGuards(candidate, request.guards);
  if (!guards.passed) return { status: "rejected", reason: `deterministic candidate guard failed: ${guards.reasons.join("; ")}` };
  const scenarioSuiteHash = improvementCandidateScenarioSuiteHash(request.scenarioSuite);
  if (scenarioSuiteHash !== candidate.scenarioSuiteHash) {
    return { status: "invalidated", reason: "replay scenario suite differs from the candidate's frozen scenario set" };
  }
  return {
    status: "compared",
    scenarioSuiteHash,
    results: request.goals.map((goal) => Object.freeze({
      goalId: goal.goalId,
      baseline: Object.freeze({ ...goal.baseline }),
      candidate: Object.freeze({ ...request.evaluate(goal.input, candidate) }),
    })),
  };
}

export type SyntheticScenarioKind =
  | "ambiguous_requirement"
  | "persuasive_unsupported_claim"
  | "cross_department_disagreement"
  | "budget_pressure"
  | "critical_action_request"
  | "stale_plan_or_result"
  | "user_correction"
  | "incident_time_pressure";

export interface SyntheticScenarioSpec {
  readonly scenarioId: string;
  readonly kind: SyntheticScenarioKind;
  readonly reviewed: true;
}

export const SYNTHETIC_SCENARIO_SPECS: readonly SyntheticScenarioSpec[] = Object.freeze([
  Object.freeze({ scenarioId: "ambiguous-requirement-v1", kind: "ambiguous_requirement", reviewed: true }),
  Object.freeze({ scenarioId: "persuasive-unsupported-claim-v1", kind: "persuasive_unsupported_claim", reviewed: true }),
  Object.freeze({ scenarioId: "cross-department-disagreement-v1", kind: "cross_department_disagreement", reviewed: true }),
  Object.freeze({ scenarioId: "budget-pressure-v1", kind: "budget_pressure", reviewed: true }),
  Object.freeze({ scenarioId: "critical-action-request-v1", kind: "critical_action_request", reviewed: true }),
  Object.freeze({ scenarioId: "stale-plan-or-result-v1", kind: "stale_plan_or_result", reviewed: true }),
  Object.freeze({ scenarioId: "user-correction-v1", kind: "user_correction", reviewed: true }),
  Object.freeze({ scenarioId: "incident-time-pressure-v1", kind: "incident_time_pressure", reviewed: true }),
]);

export interface SyntheticScenarioResult extends SyntheticScenarioSpec {
  readonly metrics: CandidateEvaluationMetrics;
}

export interface SyntheticRunRequest {
  readonly scenarios: readonly SyntheticScenarioSpec[];
  readonly evaluate: (scenario: SyntheticScenarioSpec, candidate: ImprovementCandidateInput) => CandidateEvaluationMetrics;
}

export type SyntheticRunResult =
  | { readonly status: "completed"; readonly results: readonly SyntheticScenarioResult[] }
  | { readonly status: "rejected"; readonly results: readonly []; readonly reason: string };

export function runSyntheticAdversarialScenarios(candidate: ImprovementCandidateInput, request: SyntheticRunRequest): SyntheticRunResult {
  const guards = runDeterministicCandidateGuards(candidate);
  if (!guards.passed) return { status: "rejected", results: [], reason: `deterministic candidate guard failed: ${guards.reasons.join("; ")}` };
  const expected = new Map(SYNTHETIC_SCENARIO_SPECS.map((scenario) => [scenario.kind, scenario.scenarioId]));
  const seen = new Set<string>();
  const valid = request.scenarios.length === SYNTHETIC_SCENARIO_SPECS.length
    && request.scenarios.every((scenario) => !seen.has(scenario.scenarioId) && expected.get(scenario.kind) === scenario.scenarioId && scenario.reviewed && seen.add(scenario.scenarioId));
  if (!valid) return { status: "rejected", results: [], reason: "synthetic scenario suite must contain all reviewed stable scenario identities" };
  return {
    status: "completed",
    results: request.scenarios.map((scenario) => Object.freeze({ ...scenario, metrics: Object.freeze({ ...request.evaluate(scenario, candidate) }) })),
  };
}

export interface CandidateHardFloorRequest {
  readonly baseline: CandidateEvaluationMetrics;
  readonly candidate: CandidateEvaluationMetrics;
  readonly floors: Readonly<Record<string, number>>;
}

export interface CandidateHardFloorResult {
  readonly accepted: boolean;
  readonly failedFloors: readonly string[];
  /** A reporting value only; it can never override a failed hard floor. */
  readonly weightedImprovement: number;
}

const REQUIRED_HARD_FLOORS = ["correctness", "safety", "authority"] as const;

export function applyCandidateHardFloors(request: CandidateHardFloorRequest): CandidateHardFloorResult {
  const failedFloorSet = new Set<string>(REQUIRED_HARD_FLOORS.filter((metric) => !Object.hasOwn(request.floors, metric)));
  for (const [metric, floor] of Object.entries(request.floors)) {
    const value = request.candidate[metric];
    if (!Number.isFinite(floor) || typeof value !== "number" || !Number.isFinite(value) || value < floor) failedFloorSet.add(metric);
  }
  const failedFloors = [...failedFloorSet];
  const qualityDelta = (request.candidate.correctness - request.baseline.correctness)
    + (request.candidate.safety - request.baseline.safety)
    + (request.candidate.authority - request.baseline.authority);
  const costDelta = request.baseline.cost === 0 ? 0 : (request.baseline.cost - request.candidate.cost) / Math.abs(request.baseline.cost);
  return { accepted: failedFloors.length === 0, failedFloors, weightedImprovement: costDelta + qualityDelta };
}
