import { describe, expect, it } from "vitest";
import {
  assertValidSemanticReviewRequest,
  buildSemanticReviewPrompt,
  InvalidSemanticReviewOutputError,
  InvalidSemanticReviewRequestError,
  parseSemanticReviewOutput,
  resolveSemanticReviewVerdict,
  type SemanticReviewRequest,
} from "./semantic-review.js";

const request: SemanticReviewRequest = {
  claimText: "The worker claims the migration is fully backward compatible.",
  criteria: [{ criterionId: "evidence-cited", description: "The claim must cite verifiable evidence." }],
  availableEvidenceIds: ["ev-1", "ev-2"],
};

describe("Semantic review", () => {
  it("accepts a valid request", () => {
    expect(() => assertValidSemanticReviewRequest(request)).not.toThrow();
  });
  it("rejects a request with no criteria", () => {
    expect(() => assertValidSemanticReviewRequest({ ...request, criteria: [] })).toThrow(InvalidSemanticReviewRequestError);
  });
  it("builds a prompt containing exactly the claim, fixed criteria, and evidence ids, with no peer-answer channel", () => {
    const prompt = buildSemanticReviewPrompt(request);
    expect(prompt).toContain(request.claimText);
    expect(prompt).toContain("evidence-cited");
    expect(prompt).toContain("ev-1, ev-2");
    expect(prompt).toContain("isolated semantic reviewer");
  });
  it("parses a valid structured output", () => {
    const output = parseSemanticReviewOutput(JSON.stringify({ verdict: "supported", citedEvidenceIds: ["ev-1"], reasoning: "matches ev-1" }));
    expect(output.verdict).toBe("supported");
  });
  it("rejects unparseable, malformed, or incomplete output rather than fabricating a verdict", () => {
    expect(() => parseSemanticReviewOutput("not json")).toThrow(InvalidSemanticReviewOutputError);
    expect(() => parseSemanticReviewOutput(JSON.stringify({ verdict: "maybe", citedEvidenceIds: [], reasoning: "x" }))).toThrow(InvalidSemanticReviewOutputError);
    expect(() => parseSemanticReviewOutput(JSON.stringify({ verdict: "supported", citedEvidenceIds: [], reasoning: "" }))).toThrow(InvalidSemanticReviewOutputError);
  });
  it("downgrades a supported verdict to unsupported when no cited evidence is actually durable", () => {
    const output = { verdict: "supported" as const, citedEvidenceIds: ["fabricated"], reasoning: "trust me" };
    expect(resolveSemanticReviewVerdict(output, new Set(["ev-1"]))).toBe("unsupported");
  });
  it("keeps the verdict when at least one cited evidence id is durable", () => {
    const output = { verdict: "supported" as const, citedEvidenceIds: ["fabricated", "ev-1"], reasoning: "matches ev-1" };
    expect(resolveSemanticReviewVerdict(output, new Set(["ev-1"]))).toBe("supported");
  });
});
