import { describe, expect, it } from "vitest";
import { selectArrangementCouncilApproval } from "./improvement-candidate.js";

describe("arrangement Council approval projection", () => {
  it("selects the highest-version approval deterministically regardless of query row order", () => {
    const rows = [
      { council_round_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f04", candidate_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f03", candidate_version: 2, candidate_content_hash: "b".repeat(64) },
      { council_round_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05", candidate_id: "018f3c9b-7e71-7b44-ae23-3b5d4e8c9f06", candidate_version: 3, candidate_content_hash: "a".repeat(64) },
    ];
    expect(selectArrangementCouncilApproval([...rows].reverse())?.council_round_id).toBe("018f3c9b-7e71-7b44-ae23-3b5d4e8c9f05");
  });
});
