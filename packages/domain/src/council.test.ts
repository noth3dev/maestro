import { describe, expect, it } from "vitest";
import { InvalidCouncilPayloadError, assertValidDecisionPacket, assertValidIndependentBrief, assertValidCouncilRoundContribution, isExecutableDecisionPacket, isMaterialCouncilRound } from "./council.js";

const brief = { interpretation: "deliver safely", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1 hour", expectedTime: "1 hour", objectionsToLikelyAlternatives: [] };

describe("Head Council domain validation", () => {
  it("requires every independent-brief field", () => {
    expect(() => assertValidIndependentBrief({ ...brief, risks: [""] })).toThrow(InvalidCouncilPayloadError);
    expect(() => assertValidIndependentBrief({ ...brief, expectedTime: "" })).toThrow("expectedTime");
    expect(() => assertValidIndependentBrief(brief)).not.toThrow();
  });

  it("derives material contribution from evidence or distinct arguments, not a caller flag", () => {
    expect(isMaterialCouncilRound({ summary: "repeat", newEvidence: [], distinctArguments: [] })).toBe(false);
    expect(isMaterialCouncilRound({ summary: "source", newEvidence: ["test output"], distinctArguments: [] })).toBe(true);
    expect(() => assertValidCouncilRoundContribution({ summary: "x", newEvidence: [], distinctArguments: [], hasMaterialContribution: true })).toThrow();
  });

  it("does not allow a packet with qualifying unresolved conflict to claim a decision", () => {
    const base = { executionDisposition: "executable" as const, selectedDirection: "Use bounded plan", rejectedAlternatives: [], departmentOwnership: [], workerPlan: [], completionCriteria: ["tests pass"], failureCriteria: ["test fails"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
    expect(() => assertValidDecisionPacket({ ...base, outcome: "decided", unresolvedConflicts: ["scope conflict"] })).toThrow(InvalidCouncilPayloadError);
    expect(() => assertValidDecisionPacket({ ...base, outcome: "escalated", executionDisposition: "non_executable", selectedDirection: "Escalate to Phase 3", workerPlan: [], criticalActions: [], unresolvedConflicts: ["scope conflict"] })).not.toThrow();
    expect(() => assertValidDecisionPacket({ ...base, outcome: "escalated", selectedDirection: "Escalate to Phase 3", unresolvedConflicts: ["scope conflict"] })).toThrow(/non-executable/);
    expect(() => assertValidDecisionPacket({ ...base, outcome: "escalated", executionDisposition: "non_executable", selectedDirection: "Escalate to Phase 3", workerPlan: [{ departmentId: "engineering", plan: "run" }], unresolvedConflicts: ["scope conflict"] })).toThrow(/worker plan/);
    const escalated = { ...base, outcome: "escalated" as const, executionDisposition: "non_executable" as const, selectedDirection: "Escalate to Phase 3", workerPlan: [], criticalActions: [], unresolvedConflicts: ["scope conflict"] };
    assertValidDecisionPacket(escalated);
    expect(isExecutableDecisionPacket(escalated)).toBe(false);
  });
});


describe("Head Council novelty", () => {
  it("does not count repeated evidence or arguments as material", () => {
    const prior = { newEvidence: ["evidence-1"], distinctArguments: ["argument-1"] };
    expect(isMaterialCouncilRound({ summary: "repeat", newEvidence: ["evidence-1"], distinctArguments: ["argument-1"] }, prior)).toBe(false);
    expect(isMaterialCouncilRound({ summary: "new", newEvidence: ["evidence-1"], distinctArguments: ["argument-2"] }, prior)).toBe(true);
  });
});
