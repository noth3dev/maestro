import { describe, expect, it } from "vitest";
import { arrangementCouncilQuestionMatchesCandidate, selectArrangementCandidateRows, selectArrangementCouncilApproval } from "./improvement-candidate.js";

describe("arrangement Council approval projection", () => {
  it("keeps an older active rollout target alongside a later retained revision", () => {
    const rows = [
      { candidate_id: "candidate-active", version: 2, state: "judged" },
      { candidate_id: "candidate-retained", version: 3, state: "retained" },
    ];
    const selected = selectArrangementCandidateRows(rows, new Set(["candidate-retained"]), new Set(["candidate-active:2"]));
    expect(selected).toEqual(rows);
  });
  it("selects the highest-version approval deterministically regardless of query row order", () => {
    const rows = [
      { council_round_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", candidate_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", candidate_version: 2, candidate_content_hash: "b".repeat(64) },
      { council_round_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", candidate_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06", candidate_version: 3, candidate_content_hash: "a".repeat(64) },
    ];
    expect(selectArrangementCouncilApproval([...rows].reverse())?.council_round_id).toBe("018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05");
  });

  it("matches a durable Council round to the exact candidate binding", () => {
    expect(arrangementCouncilQuestionMatchesCandidate(
      "Candidate: 018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03 version 2 schemaVersion 1 contentHash " + "a".repeat(64) + " (persona_axis)",
      { candidateId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", version: 2, contentHash: "a".repeat(64), kind: "persona_axis" },
    )).toBe(true);
    expect(arrangementCouncilQuestionMatchesCandidate(
      "Candidate: 018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03 version 2 schemaVersion 1 contentHash " + "b".repeat(64) + " (persona_axis)",
      { candidateId: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", version: 2, contentHash: "a".repeat(64), kind: "persona_axis" },
    )).toBe(false);
  });
});
