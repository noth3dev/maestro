import { describe, expect, it, vi } from "vitest";
import { improvementCandidateScenarioSuiteHash, type ImprovementCandidateInput } from "@maestro/domain";
import { createNativeRefinementAdapter, type NativeRefinementRequest } from "./native-refinement.js";

const candidate = (overrides: Partial<ImprovementCandidateInput> = {}): ImprovementCandidateInput => ({
  schemaVersion: 1,
  projectId: "11111111-1111-4111-8111-111111111111",
  goalId: "22222222-2222-4222-8222-222222222222",
  kind: "persona_axis",
  target: { roleId: "head-engineering", taskClass: "implementation" },
  changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }],
  sourceEvidenceIds: ["33333333-3333-4333-8333-333333333333"],
  evidencePattern: "Two comparable Goals recorded avoidable risk-review omissions.",
  predictedEffect: "The role will surface reversible-risk checks earlier.",
  expectedMetrics: [{ name: "useful_risk_findings", unit: "count", direction: "increase", target: 1 }],
  protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9, maximum: 1 }],
  scenarioSuite: ["implementation-risk-review-v1"],
  scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["implementation-risk-review-v1"]),
  confidence: 0.84,
  dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
  rollbackTarget: { candidateId: "44444444-4444-4444-8444-444444444444", version: 1, contentHash: "0".repeat(64) },
  ...overrides,
});

const passingEvaluation = {
  replayPassed: true,
  syntheticPassed: true,
  shadowPassed: true,
  independentCouncilPassed: true,
  episodeCount: 3,
  comparableGoalCount: 2,
};

const request = (overrides: Partial<NativeRefinementRequest> = {}): NativeRefinementRequest => ({
  candidate: candidate(),
  component: "prompt_guidance",
  scope: "project",
  evaluation: passingEvaluation,
  ...overrides,
});

describe("native refinement boundary", () => {
  it("rejects out-of-scope components before evaluation", () => {
    const evaluate = vi.fn();
    const adapter = createNativeRefinementAdapter({ enabledClasses: ["persona_axis"], evaluate });
    expect(() => adapter.refine(request({ component: "provider_config" as never }))).toThrow(/component|scope|provider/i);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("uses the shared ImprovementCandidate schema for every required proposal field", () => {
    const adapter = createNativeRefinementAdapter({ enabledClasses: ["persona_axis"] });
    for (const field of ["evidencePattern", "predictedEffect", "sourceEvidenceIds", "rollbackTarget"] as const) {
      const incomplete = { ...candidate() } as Record<string, unknown>;
      delete incomplete[field];
      expect(() => adapter.refine(request({ candidate: incomplete as ImprovementCandidateInput })), field).toThrow(/required|candidate|evidence|rollback/i);
    }
  });

  it("auto-applies enabled project refinements, observes them, and rolls them back", () => {
    const adapter = createNativeRefinementAdapter({ enabledClasses: ["persona_axis"] });
    const applied = adapter.refine(request());
    expect(applied.status).toBe("applied");
    expect(adapter.observe(applied.refinementId, { regression: false }).status).toBe("observed");
    expect(adapter.rollback(applied.refinementId).status).toBe("rolled_back");
  });

  it("requires the multi-episode bar for global refinement even when its class is enabled", () => {
    const adapter = createNativeRefinementAdapter({ enabledClasses: ["persona_axis"] });
    expect(() => adapter.refine(request({ scope: "global", evaluation: { ...passingEvaluation, episodeCount: 1, comparableGoalCount: 1 } }))).toThrow(/episode|global|evidence/i);
    const applied = adapter.refine(request({ scope: "global" }));
    expect(applied.status).toBe("applied");
    expect(() => adapter.refine(request({ scope: "global", mutation: "semantic_reversal" }))).toThrow(/CEO|approval|reversal|existing/i);
    const revised = adapter.refine(request({ scope: "global", mutation: "narrow_reversible", ceoApproved: true, existingRefinementId: applied.refinementId }));
    expect(revised.status).toBe("applied");
    expect(adapter.history(applied.refinementId)).toHaveLength(2);
  });

  it("deprecates and observes an unused global entry before CEO-approved removal", () => {
    const adapter = createNativeRefinementAdapter({ enabledClasses: [] });
    const entry = adapter.refine(request({ scope: "global" }));
    expect(() => adapter.removeGlobal(entry.refinementId, { ceoApproved: true })).toThrow(/deprecat|observ/i);
    expect(adapter.deprecateGlobal(entry.refinementId).status).toBe("deprecated");
    expect(adapter.observeGlobal(entry.refinementId, { used: false }).status).toBe("observed");
    expect(adapter.removeGlobal(entry.refinementId, { ceoApproved: true }).status).toBe("removed");
  });
});
