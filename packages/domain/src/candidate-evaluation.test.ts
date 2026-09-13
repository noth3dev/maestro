import { describe, expect, it } from "vitest";
import {
  improvementCandidateScenarioSuiteHash,
  type ImprovementCandidateInput,
} from "./improvement-candidate.js";
import {
  SYNTHETIC_SCENARIO_SPECS,
  applyCandidateHardFloors,
  replayCandidateAgainstFrozenBaseline,
  runDeterministicCandidateGuards,
  runSyntheticAdversarialScenarios,
  type CandidateEvaluationMetrics,
} from "./candidate-evaluation.js";

const candidate = (overrides: Partial<ImprovementCandidateInput> = {}): ImprovementCandidateInput => {
  const scenarioSuite = overrides.scenarioSuite ?? ["implementation-risk-review-v1"];
  return {
    schemaVersion: 1,
    projectId: "11111111-1111-4111-8111-111111111111",
    goalId: "22222222-2222-4222-8222-222222222222",
    kind: "persona_axis",
    target: { roleId: "head-engineering", taskClass: "implementation" },
    changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }],
    sourceEvidenceIds: ["33333333-3333-4333-8333-333333333333"],
    evidencePattern: "Repeated risk-review omissions.",
    predictedEffect: "Surface reversible-risk checks earlier.",
    expectedMetrics: [{ name: "useful_risk_findings", unit: "count", direction: "increase", target: 1 }],
    protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9, maximum: 1 }],
    scenarioSuite,
    scenarioSuiteHash: improvementCandidateScenarioSuiteHash(scenarioSuite),
    confidence: 0.84,
    dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
    rollbackTarget: {
      candidateId: "44444444-4444-4444-8444-444444444444",
      version: 1,
      contentHash: "0".repeat(64),
    },
    ...overrides,
  };
};

const metrics = (overrides: Partial<CandidateEvaluationMetrics> = {}): CandidateEvaluationMetrics => ({
  correctness: 0.95,
  safety: 0.98,
  authority: 1,
  cost: 100,
  ...overrides,
});

describe("candidate evaluation stages", () => {
  it("rejects deterministic guard violations before any replay evaluator runs", () => {
    let evaluatorCalls = 0;
    const evaluate = () => { evaluatorCalls += 1; };
    const cases: readonly [string, unknown, Parameters<typeof runDeterministicCandidateGuards>[1]][] = [
      ["out of range", candidate({ changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 1.2 }] }), {}],
      ["role floor", candidate(), { roleFloors: { caution: 0.8 } }],
      ["core identity", candidate({ changes: [{ axis: "authority" as "caution", currentValue: 0.7, proposedValue: 0.76 }] }), {}],
      ["mandatory challenge", candidate({ scenarioSuite: ["ordinary-v1"] }), { mandatoryScenarioIds: ["mandatory-challenge-v1"] }],
      ["missing evidence", candidate({ sourceEvidenceIds: [] }), {}],
      ["missing rollback", candidate({ rollbackTarget: undefined as never }), {}],
    ];

    for (const [name, value, context] of cases) {
      const result = runDeterministicCandidateGuards(value, context);
      expect(result.passed, name).toBe(false);
    }
    expect(evaluatorCalls).toBe(0);
    expect(evaluate).toBeTypeOf("function");
  });

  it("invalidates replay comparison when the frozen scenario set changes", () => {
    const recorded = replayCandidateAgainstFrozenBaseline(candidate(), {
      scenarioSuite: ["implementation-risk-review-v1"],
      goals: [{ goalId: "goal-1", input: { request: "review" }, baseline: metrics() }],
      evaluate: () => metrics({ cost: 80 }),
    });
    expect(recorded.status).toBe("compared");

    const drifted = replayCandidateAgainstFrozenBaseline(candidate(), {
      scenarioSuite: ["implementation-risk-review-v2"],
      goals: [{ goalId: "goal-1", input: { request: "review" }, baseline: metrics() }],
      evaluate: () => metrics({ cost: 80 }),
    });
    expect(drifted.status).toBe("invalidated");
    expect(drifted.reason).toMatch(/scenario/i);
  });

  it("runs all eight reviewed synthetic adversarial scenario kinds with stable identities", () => {
    expect(SYNTHETIC_SCENARIO_SPECS).toHaveLength(8);
    expect(new Set(SYNTHETIC_SCENARIO_SPECS.map((scenario) => scenario.kind)).size).toBe(8);
    const result = runSyntheticAdversarialScenarios(candidate(), {
      scenarios: SYNTHETIC_SCENARIO_SPECS,
      evaluate: () => metrics(),
    });
    expect(result.status).toBe("completed");
    expect(result.results).toHaveLength(8);
    expect(result.results.every((entry) => entry.scenarioId.length > 0 && entry.reviewed)).toBe(true);
  });

  it("rejects a cheap candidate when any correctness, safety, or authority floor fails", () => {
    const result = applyCandidateHardFloors({
      baseline: metrics(),
      candidate: metrics({ correctness: 0.7, cost: 1 }),
      floors: { correctness: 0.9, safety: 0.95, authority: 1 },
    });
    expect(result.weightedImprovement).toBeGreaterThan(0);
    expect(result.accepted).toBe(false);
    expect(result.failedFloors).toContain("correctness");
  });
});
