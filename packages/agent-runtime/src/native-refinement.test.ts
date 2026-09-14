import { describe, expect, it, vi } from "vitest";
import { improvementCandidateScenarioSuiteHash, type ImprovementCandidateInput } from "@carnegie/domain";
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
  evidenceIds: ["33333333-3333-4333-8333-333333333333"],
  episodeIds: ["episode-a", "episode-b", "episode-c"],
};

const createAdapter = (enabledClasses: readonly ("persona_axis" | "routing_capability_axis")[] = ["persona_axis"]) => createNativeRefinementAdapter({
  enabledClasses,
  restoreRollbackTarget: () => true,
  verifyGlobalEvidence: () => true,
  classifyMutation: () => "narrow_reversible",
  verifyCeoApproval: () => true,
} as never);

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
    const adapter = createNativeRefinementAdapter({ enabledClasses: ["persona_axis"], evaluate } as never);
    expect(() => adapter.refine(request({ component: "provider_config" as never }))).toThrow(/component|scope|provider/i);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("uses the shared ImprovementCandidate schema for every required proposal field", () => {
    const adapter = createAdapter();
    for (const field of ["evidencePattern", "predictedEffect", "sourceEvidenceIds", "rollbackTarget"] as const) {
      const incomplete = { ...candidate() } as Record<string, unknown>;
      delete incomplete[field];
      expect(() => adapter.refine(request({ candidate: incomplete as ImprovementCandidateInput })), field).toThrow(/required|candidate|evidence|rollback/i);
    }
  });

  it("auto-applies enabled project refinements, observes them, and rolls them back", () => {
    const adapter = createAdapter();
    const applied = adapter.refine(request());
    expect(applied.status).toBe("applied");
    expect(adapter.observe(applied.refinementId, { regression: false }).status).toBe("observed");
    expect(adapter.rollback(applied.refinementId).status).toBe("rolled_back");
  });

  it("requires the multi-episode bar for global refinement even when its class is enabled", () => {
    const adapter = createAdapter();
    expect(() => adapter.refine(request({ scope: "global", evaluation: { ...passingEvaluation, episodeCount: 1, comparableGoalCount: 1 } }))).toThrow(/episode|global|evidence/i);
    const applied = adapter.refine(request({ scope: "global" }));
    expect(applied.status).toBe("applied");
    expect(() => adapter.refine(request({ scope: "global", mutation: "semantic_reversal" }))).toThrow(/CEO|approval|reversal|existing/i);
    const destructiveAdapter = createNativeRefinementAdapter({ enabledClasses: ["persona_axis"], restoreRollbackTarget: () => true, verifyGlobalEvidence: () => true, classifyMutation: () => "semantic_reversal", verifyCeoApproval: () => true } as never);
    const destructiveEntry = destructiveAdapter.refine(request({ scope: "global" }));
    const destructiveTarget = { candidateId: destructiveEntry.refinementId, version: destructiveEntry.version, contentHash: destructiveEntry.candidateContentHash };
    expect(() => destructiveAdapter.refine(request({ scope: "global", mutation: "semantic_reversal", candidate: candidate({ rollbackTarget: destructiveTarget }), existingRefinementId: destructiveEntry.refinementId, ceoApproval: { approvalId: "unverified" } as never }))).toThrow(/CEO|approval|verified|exact/i);
    const predecessorTarget = { candidateId: applied.refinementId, version: applied.version, contentHash: applied.candidateContentHash };
    expect(() => adapter.refine(request({ scope: "global", mutation: "narrow_reversible", existingRefinementId: applied.refinementId }))).toThrow(/rollback|predecessor|target/i);
    const revised = adapter.refine(request({ scope: "global", mutation: "narrow_reversible", candidate: candidate({ rollbackTarget: predecessorTarget }), existingRefinementId: applied.refinementId }));
    expect(revised.status).toBe("applied");
    expect(adapter.history(applied.refinementId)).toHaveLength(2);
  });

  it("binds global evidence counts and requires distinct independently verified episodes", () => {
    const adapter = createAdapter();
    expect(() => adapter.refine(request({ scope: "global", candidate: candidate({ dataSufficiency: { episodeCount: 1, comparableGoalCount: 1 } }) }))).toThrow(/match|evidence|episode/i);
    expect(() => adapter.refine(request({ scope: "global", evaluation: { ...passingEvaluation, episodeIds: ["episode-a", "episode-a"] } }))).toThrow(/distinct|episode|evidence/i);
  });

  it("binds an existing refinement to its original scope and project", () => {
    const adapter = createAdapter();
    const entry = adapter.refine(request());
    const predecessorTarget = { candidateId: entry.refinementId, version: entry.version, contentHash: entry.candidateContentHash };
    expect(() => adapter.refine(request({ scope: "global", candidate: candidate({ rollbackTarget: predecessorTarget }), existingRefinementId: entry.refinementId, mutation: "scope_expansion" }))).toThrow(/scope|CEO|approval/i);
    expect(() => adapter.refine(request({ candidate: candidate({ projectId: "99999999-9999-4999-8999-999999999999" }), existingRefinementId: entry.refinementId, mutation: "narrow_reversible" }))).toThrow(/project|scope/i);
  });

  it("rejects unsupported top-level controls instead of ignoring them", () => {
    const adapter = createAdapter();
    expect(() => adapter.refine(request({ authority: true } as never))).toThrow(/unknown|unsupported|authority/i);
  });

  it("binds a revision rollback target to the immutable predecessor", () => {
    const adapter = createAdapter();
    const entry = adapter.refine(request());
    expect(() => adapter.refine(request({ existingRefinementId: entry.refinementId, mutation: "narrow_reversible" }))).toThrow(/rollback|predecessor|target/i);
    const predecessorTarget = { candidateId: entry.refinementId, version: entry.version, contentHash: entry.candidateContentHash };
    const revision = adapter.refine(request({ existingRefinementId: entry.refinementId, mutation: "narrow_reversible", candidate: candidate({ rollbackTarget: predecessorTarget }) }));
    expect(revision.previousCandidate).toEqual(entry.candidate);
  });

  it("passes frozen candidate snapshots to hooks and rechecks their exact hash", () => {
    const mutate = vi.fn(({ candidate: value }: NativeRefinementRequest) => {
      expect(() => { (value as { projectId: string }).projectId = "99999999-9999-4999-8999-999999999999"; }).toThrow();
    });
    const adapter = createNativeRefinementAdapter({ enabledClasses: ["persona_axis"], evaluate: mutate } as never);
    expect(() => adapter.refine(request())).not.toThrow();
    expect(mutate).toHaveBeenCalled();
  });

  it("snapshots enabled classes at construction", () => {
    const enabled = ["persona_axis"] as ("persona_axis" | "routing_capability_axis")[];
    const adapter = createNativeRefinementAdapter({ enabledClasses: enabled, restoreRollbackTarget: () => true } as never);
    enabled.length = 0;
    expect(adapter.refine(request()).status).toBe("applied");
  });

  it("retains evaluation and rollback metadata and fails closed without an exact restore", () => {
    const adapter = createAdapter();
    const entry = adapter.refine(request());
    expect(entry.evaluation).toEqual(passingEvaluation);
    expect(entry.rollbackTrigger.rollbackTarget).toEqual(candidate().rollbackTarget);
    expect(entry.rolloutScope).toMatchObject({ scope: "project", projectId: candidate().projectId });
    const noRestore = createNativeRefinementAdapter({ enabledClasses: ["persona_axis"] });
    const noRestoreEntry = noRestore.refine(request());
    expect(() => noRestore.rollback(noRestoreEntry.refinementId)).toThrow(/restore|rollback/i);
  });

  it("deprecates and observes an unused global entry before CEO-approved removal", () => {
    const adapter = createAdapter([]);
    const entry = adapter.refine(request({ scope: "global" }));
    const removalApproval = { approvalId: "ceo-remove", candidateContentHash: entry.candidateContentHash, component: entry.component, scope: "global" as const, mutation: "delete" as const, existingRefinementId: entry.refinementId };
    expect(() => adapter.removeGlobal(entry.refinementId, removalApproval)).toThrow(/deprecat|observ/i);
    expect(adapter.deprecateGlobal(entry.refinementId).status).toBe("deprecated");
    expect(adapter.observeGlobal(entry.refinementId, { used: false }).status).toBe("observed");
    expect(adapter.removeGlobal(entry.refinementId, removalApproval).status).toBe("removed");
  });
});
