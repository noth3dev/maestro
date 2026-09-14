import { describe, expect, it } from "vitest";
import { ArrangementsReadSchema } from "./index.js";

const ids = { projectId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f01", goalId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f02", candidateId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03" };

describe("Arrangements read contract", () => {
  it("accepts real candidate lifecycle, metric deltas, Council judgments, and rollout status", () => {
    const result = ArrangementsReadSchema.parse({
      active: [{ ...ids, version: 2, kind: "persona_axis", state: "judged", contentHash: "a".repeat(64), parentCandidateId: ids.candidateId, target: { roleId: "head-engineering", taskClass: "implementation" }, changes: [{ axis: "caution", currentValue: 0.5, proposedValue: 0.6 }], sourceEvidenceIds: [ids.candidateId], predictedEffect: "Surface checks earlier.", evaluation: { evaluationId: ids.candidateId, evaluationHash: "b".repeat(64), stages: { replay: "compared", shadow: "completed", synthetic: "completed" }, metricDeltas: [{ name: "correctness", baseline: 0.9, candidate: 0.95, delta: 0.05 }] }, rejectionReason: null, rollout: { rolloutId: ids.candidateId, status: "active", activeCandidateId: ids.candidateId, activeVersion: 2, contentHash: "a".repeat(64) } }],
      candidates: [],
      encoreCouncil: [{ candidateId: ids.candidateId, roundId: ids.candidateId, question: "Should this proceed?", reviewerCount: 1, sameModelOnly: false, escalated: false, dissentNotes: [], finalVerdict: "proceed", judgments: [{ modelProvider: "provider-a", modelId: "model-a", verdict: "proceed", confidence: "high", reasoning: "Durable evidence supports this.", conditions: [], dissentNote: null, citedEvidenceIds: [ids.candidateId] }] }],
      negativeEvidence: [{ candidateId: ids.candidateId, state: "rejected", reason: "Council judgment rejected the proposal.", roundId: ids.candidateId, judgments: [{ modelProvider: "provider-a", modelId: "model-a", verdict: "do_not_proceed", confidence: "high", reasoning: "Protected metric regression.", conditions: [], dissentNote: null, citedEvidenceIds: [ids.candidateId] }] }],
    });
    expect(result.active[0]?.evaluation?.metricDeltas[0]?.delta).toBeCloseTo(0.05);
    expect(result.encoreCouncil[0]?.judgments[0]?.reasoning).toContain("Durable");
    expect(result.negativeEvidence[0]?.reason).toContain("rejected");
  });

  it("keeps every stage empty when no durable arrangements exist", () => {
    expect(ArrangementsReadSchema.parse({ active: [], candidates: [], encoreCouncil: [], negativeEvidence: [] })).toEqual({ active: [], candidates: [], encoreCouncil: [], negativeEvidence: [] });
  });

  it("allows a rejected latest candidate with no Council row and no fabricated reason", () => {
    expect(ArrangementsReadSchema.parse({ active: [], candidates: [], encoreCouncil: [], negativeEvidence: [{ candidateId: ids.candidateId, state: "rejected", reason: null, roundId: null, judgments: [] }] }).negativeEvidence[0]?.reason).toBeNull();
  });
});
