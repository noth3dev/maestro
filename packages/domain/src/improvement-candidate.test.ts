import { describe, expect, it } from "vitest";
import {
  assertValidImprovementCandidateInput,
  canTransitionImprovementCandidate,
  improvementCandidateScenarioSuiteHash,
  createImprovementCandidateVersion,
  materializeImprovementCandidate,
  type ImprovementCandidateInput,
} from "./improvement-candidate.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";
const DIGEST_ID = "33333333-3333-4333-8333-333333333333";
const BASELINE_ID = "44444444-4444-4444-8444-444444444444";
const CANDIDATE_ID = "55555555-5555-4555-8555-555555555555";

const candidate = (overrides: Partial<ImprovementCandidateInput> = {}): ImprovementCandidateInput => ({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  goalId: GOAL_ID,
  kind: "persona_axis",
  target: { roleId: "head-engineering", taskClass: "implementation" },
  changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }],
  sourceEvidenceIds: [DIGEST_ID],
  evidencePattern: "Two comparable Goals recorded avoidable risk-review omissions.",
  predictedEffect: "The role will surface reversible-risk checks earlier.",
  expectedMetrics: [{ name: "useful_risk_findings", unit: "count", direction: "increase", target: 1 }],
  protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9, maximum: 1 }],
  scenarioSuite: ["implementation-risk-review-v1"],
  scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["implementation-risk-review-v1"]),
  confidence: 0.84,
  dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
  rollbackTarget: { candidateId: BASELINE_ID, version: 1, contentHash: "0".repeat(64) },
  ...overrides,
});

const identity = {
  candidateId: CANDIDATE_ID,
  version: 1,
  parentCandidateId: null,
  authorId: "encore-lab",
  sessionRef: "session:candidate:1",
  createdAt: "2026-09-13T12:00:00.000Z",
};

describe("Improvement Candidate contract", () => {
  it("requires every lifecycle input needed to evaluate and roll back a candidate", () => {
    const required = [
      "target", "changes", "sourceEvidenceIds", "evidencePattern", "predictedEffect",
      "expectedMetrics", "protectedMetrics", "scenarioSuite", "scenarioSuiteHash", "confidence", "dataSufficiency", "rollbackTarget",
    ] as const;
    for (const field of required) {
      const incomplete = { ...candidate() } as Record<string, unknown>;
      delete incomplete[field];
      expect(() => assertValidImprovementCandidateInput(incomplete), field).toThrow(/required|candidate/i);
    }
  });

  it("rejects a persona candidate that changes more than two axes before evaluation", () => {
    expect(() => assertValidImprovementCandidateInput(candidate({
      changes: [
        { axis: "caution", currentValue: 0.7, proposedValue: 0.76 },
        { axis: "realism", currentValue: 0.8, proposedValue: 0.84 },
        { axis: "initiative", currentValue: 0.6, proposedValue: 0.65 },
      ],
    }))).toThrow(/two|axes/i);
  });

  it("uses the same lifecycle states for persona-axis and routing-capability candidates", () => {
    const persona = materializeImprovementCandidate(candidate(), identity);
    const routing = materializeImprovementCandidate(candidate({
      kind: "routing_capability_axis",
      target: { routingTarget: "openai/gpt-5" },
      changes: [{ axis: "verification", currentValue: 120, proposedValue: 135 }],
    }), { ...identity, candidateId: "66666666-6666-4666-8666-666666666666" });

    expect(persona.state).toBe("candidate");
    expect(routing.state).toBe("candidate");
    expect(canTransitionImprovementCandidate(persona.state, "evaluated")).toBe(true);
    expect(canTransitionImprovementCandidate(routing.state, "evaluated")).toBe(true);
    expect(canTransitionImprovementCandidate("evaluated", "judged")).toBe(true);
    expect(canTransitionImprovementCandidate("judged", "applied")).toBe(true);
    expect(canTransitionImprovementCandidate("applied", "rolled_back")).toBe(true);
    expect(canTransitionImprovementCandidate("candidate", "applied")).toBe(false);
  });

  it("creates an append-only revision with parent lineage instead of mutating the original", () => {
    const original = materializeImprovementCandidate(candidate(), identity);
    const revision = createImprovementCandidateVersion(original, {
      ...candidate(),
      changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.74 }],
    }, {
      candidateId: "77777777-7777-4777-8777-777777777777",
      version: 2,
      parentCandidateId: original.candidateId,
      authorId: "encore-lab",
      sessionRef: "session:candidate:2",
      createdAt: "2026-09-13T12:01:00.000Z",
    });

    expect(revision.version).toBe(2);
    expect(revision.parentCandidateId).toBe(original.candidateId);
    expect(revision.candidateId).not.toBe(original.candidateId);
    expect(original.version).toBe(1);
    expect(original.changes[0]!.proposedValue).toBe(0.76);
  });

  it("accepts the shared routing shape while enforcing its target and score semantics", () => {
    expect(() => assertValidImprovementCandidateInput(candidate({
      kind: "routing_capability_axis",
      target: { routingTarget: "anthropic/claude-sonnet" },
      changes: [{ axis: "coding", currentValue: 100, proposedValue: 101 }],
    }))).not.toThrow();
    expect(() => assertValidImprovementCandidateInput(candidate({
      kind: "routing_capability_axis",
      target: { roleId: "head-engineering" },
    }))).toThrow(/routing/i);
    expect(() => assertValidImprovementCandidateInput(candidate({
      changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 1.2 }],
    }))).toThrow(/range|\[0,1\]/i);
    expect(() => assertValidImprovementCandidateInput(candidate({
      scenarioSuiteHash: "f".repeat(64),
    }))).toThrow(/scenario|hash/i);
  });
});
