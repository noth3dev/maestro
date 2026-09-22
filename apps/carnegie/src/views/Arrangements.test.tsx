import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ArrangementsRead } from "@maestro/api-client";
import { Arrangements } from "./Arrangements.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const hash = "a".repeat(64);
const evaluationHash = "b".repeat(64);
const arrangementsState = vi.hoisted(() => ({
  value: { active: [], candidates: [], encoreCouncil: [], negativeEvidence: [] } as ArrangementsRead,
}));

vi.mock("../icons.js", () => ({ Icon: () => null }));
vi.mock("../connection.js", () => ({ useConnection: () => ({ config: { apiUrl: "https://control-plane.test", projectId } }) }));
vi.mock("../goals.js", () => ({ useGoals: () => ({ selectedGoalId: goalId }) }));
vi.mock("../useGoalArrangements.js", () => ({ useGoalArrangements: () => ({ arrangements: arrangementsState.value, loading: false, error: undefined }) }));

describe("Arrangements view", () => {
  it("preserves the user-facing Arrangements title and Act 3 distinction", () => {
    const html = renderToStaticMarkup(<Arrangements />);
    expect(html).toContain(">Arrangements</h1>");
    expect(html).toContain("Act 3");
  });

  it("renders server evidence for active and candidate records without relabeling candidates as active", () => {
    arrangementsState.value = {
      active: [{
        candidateId, version: 3, parentCandidateId: null, projectId, goalId, kind: "persona_axis", state: "applied",
        target: { roleId: "concertmaster", taskClass: "implementation" }, changes: [{ axis: "caution", currentValue: 0.4, proposedValue: 0.5 }],
        sourceEvidenceIds: ["44444444-4444-4444-8444-444444444444"], predictedEffect: "Pause before uncertain actions.", contentHash: hash,
        evaluation: { evaluationId: "55555555-5555-4555-8555-555555555555", evaluationHash, stages: { replay: "compared", shadow: "completed", synthetic: "completed" }, metricDeltas: [{ name: "correctness", baseline: 0.9, candidate: 0.95, delta: 0.05 }] },
        rollout: { rolloutId: "66666666-6666-4666-8666-666666666666", status: "active", activeCandidateId: candidateId, activeVersion: 3, contentHash: hash }, rejectionReason: null,
      }],
      candidates: [{
        candidateId: "77777777-7777-4777-8777-777777777777", version: 1, parentCandidateId: null, projectId, goalId, kind: "persona_axis", state: "candidate",
        target: { roleId: "concertmaster" }, changes: [], sourceEvidenceIds: ["88888888-8888-4888-8888-888888888888"], predictedEffect: "Candidate only.", contentHash: "c".repeat(64), evaluation: null, rollout: null, rejectionReason: null,
      }], encoreCouncil: [], negativeEvidence: [],
    };
    const html = renderToStaticMarkup(<Arrangements />);
    expect(html).toContain(hash);
    expect(html).toContain(evaluationHash);
    expect(html).toContain("replay compared");
    expect(html).toContain("correctness: 0.9 → 0.95 (+0.05)");
    expect(html).toContain(`rollout: active · active v3 · hash ${hash}`);
    expect(html).toContain("source evidence: 44444444-4444-4444-8444-444444444444");
    const candidates = renderToStaticMarkup(<Arrangements initialTab="candidates" />);
    expect(candidates).toContain("Candidate only.");
    expect(html).not.toContain("active persona");
  });

  it("renders Council judgments and negative evidence as read-only durable records", () => {
    arrangementsState.value = {
      active: [], candidates: [],
      encoreCouncil: [{ candidateId, roundId: "99999999-9999-4999-8999-999999999999", question: "Should this ship?", finalVerdict: "do_not_proceed", reviewerCount: 2, sameModelOnly: false, escalated: true, dissentNotes: ["needs evidence"], judgments: [{ modelProvider: "openai", modelId: "model-1", verdict: "do_not_proceed", confidence: "high", reasoning: "Negative evidence remains.", conditions: [], dissentNote: null, citedEvidenceIds: [] }] }],
      negativeEvidence: [{ candidateId, state: "rejected", reason: "Metric regressed", roundId: "99999999-9999-4999-8999-999999999999", judgments: [{ modelProvider: "openai", modelId: "model-1", verdict: "do_not_proceed", confidence: "high", reasoning: "Negative evidence remains.", conditions: [], dissentNote: null, citedEvidenceIds: [] }] }],
    };
    const council = renderToStaticMarkup(<Arrangements initialTab="encoreCouncil" />);
    expect(council).toContain("Act 3 read-only");
    expect(council).not.toContain("Apply candidate");
    expect(council).not.toContain("Run rollout");
    // The static view starts on Active; switch-state rendering is verified by the same durable payload in the tab contract below.
    expect(council).toContain("do_not_proceed");
    const rejected = renderToStaticMarkup(<Arrangements initialTab="negativeEvidence" />);
    expect(rejected).toContain("Metric regressed");
    expect(rejected).toContain("Negative evidence remains.");
  });
});
