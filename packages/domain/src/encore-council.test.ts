import { describe, expect, it } from "vitest";
import { evaluateEncoreTriggers, InvalidEncoreJudgmentError, synthesizeEncoreJudgments, type EncoreJudgmentSubstance } from "./encore-council.js";

const judgment = (overrides: Partial<EncoreJudgmentSubstance> = {}): EncoreJudgmentSubstance => ({
  modelProvider: "prime", modelId: "kimi", verdict: "proceed", confidence: "high", reasoning: "evidence supports proceeding",
  conditions: [], dissentNote: null, citedEvidenceIds: ["ev-1"],
  ...overrides,
});

describe("Encore Council trigger policy", () => {
  it("does not trigger on a routine single-Department Goal with no challenges or uncertainty", () => {
    expect(evaluateEncoreTriggers({ departmentOwnershipCount: 1, openChallengeCount: 0, ambiguousOrUnsupportedReviewCount: 0 })).toHaveLength(0);
  });
  it("triggers on a cross-Department Goal", () => {
    expect(evaluateEncoreTriggers({ departmentOwnershipCount: 2, openChallengeCount: 0, ambiguousOrUnsupportedReviewCount: 0 })).toContain("cross_department_material");
  });
  it("triggers on an unresolved Sentinel challenge", () => {
    expect(evaluateEncoreTriggers({ departmentOwnershipCount: 1, openChallengeCount: 1, ambiguousOrUnsupportedReviewCount: 0 })).toContain("unresolved_sentinel_challenge");
  });
  it("triggers on high uncertainty from semantic review", () => {
    expect(evaluateEncoreTriggers({ departmentOwnershipCount: 1, openChallengeCount: 0, ambiguousOrUnsupportedReviewCount: 1 })).toContain("high_uncertainty_semantic_review");
  });
});

describe("Encore Council synthesis", () => {
  it("agrees when all judgments proceed with high confidence, preserving no dissent when there is none", () => {
    const synthesis = synthesizeEncoreJudgments([judgment(), judgment({ modelProvider: "openai", modelId: "gpt" })]);
    expect(synthesis.finalVerdict).toBe("proceed");
    expect(synthesis.escalated).toBe(false);
    expect(synthesis.sameModelOnly).toBe(false);
    expect(synthesis.dissentNotes).toHaveLength(0);
  });
  it("labels a same-model-only synthesis honestly", () => {
    const synthesis = synthesizeEncoreJudgments([judgment(), judgment()]);
    expect(synthesis.sameModelOnly).toBe(true);
  });
  it("preserves every minority dissent note rather than deleting it", () => {
    const synthesis = synthesizeEncoreJudgments([judgment(), judgment({ dissentNote: "I disagree with the majority", modelProvider: "openai", modelId: "gpt" })]);
    expect(synthesis.dissentNotes).toEqual(["I disagree with the majority"]);
  });
  it("escalates on material disagreement between judgments", () => {
    const synthesis = synthesizeEncoreJudgments([judgment({ verdict: "proceed" }), judgment({ verdict: "do_not_proceed", modelProvider: "openai", modelId: "gpt" })]);
    expect(synthesis.escalated).toBe(true);
    expect(synthesis.finalVerdict).toBe("escalate");
  });
  it("escalates on low confidence combined with same-model-only (insufficient diversity)", () => {
    const synthesis = synthesizeEncoreJudgments([judgment({ confidence: "low" }), judgment({ confidence: "high" })]);
    expect(synthesis.escalated).toBe(true);
  });
  it("does not escalate merely for insufficient diversity when all judgments are high confidence and agree", () => {
    const synthesis = synthesizeEncoreJudgments([judgment(), judgment()]);
    expect(synthesis.escalated).toBe(false);
  });
  it("escalates immediately if any single reviewer votes to escalate", () => {
    const synthesis = synthesizeEncoreJudgments([judgment({ verdict: "escalate" }), judgment({ modelProvider: "openai", modelId: "gpt" })]);
    expect(synthesis.escalated).toBe(true);
  });
  it("rejects synthesizing zero judgments", () => {
    expect(() => synthesizeEncoreJudgments([])).toThrow(InvalidEncoreJudgmentError);
  });
});
