import { describe, expect, it } from "vitest";
import { headAskWithFallback, parseHeadBriefDecision } from "./head-brief-runtime.js";

const brief = {
  interpretation: "i", contribution: "c", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [],
  proposedValidation: [], expectedWorkers: [], expectedCost: "s", expectedTime: "t", objectionsToLikelyAlternatives: [],
};

describe("Head brief decision", () => {
  it("reads a brief or a reasoned withdrawal, tolerating text around the JSON", () => {
    expect(parseHeadBriefDecision(`\`\`\`json\n${JSON.stringify({ needed: true, brief })}\n\`\`\``)).toEqual({ needed: true, brief });
    expect(parseHeadBriefDecision('Verdict: {"needed": false, "reason": "  No UI work. "}')).toEqual({ needed: false, reason: "No UI work." });
  });

  it("rejects replies that do not settle the Head", () => {
    expect(() => parseHeadBriefDecision("sure")).toThrow("no JSON");
    expect(() => parseHeadBriefDecision("{not json}")).toThrow("not valid JSON");
    expect(() => parseHeadBriefDecision('{"needed": false}')).toThrow("reason");
    expect(() => parseHeadBriefDecision('{"brief": {}}')).toThrow("whether");
    expect(() => parseHeadBriefDecision(JSON.stringify({ needed: true, brief: { ...brief, extra: 1 } }))).toThrow("invalid");
  });

  it("falls back when the Head's own execution is gone", async () => {
    const input = { goalId: "g", departmentId: "design", sessionRef: "s", system: "sys", prompt: "p" };
    const ask = headAskWithFallback(async () => { throw new Error("unknown execution"); }, async () => "fallback");
    await expect(ask(input)).resolves.toBe("fallback");
    await expect(headAskWithFallback(async () => "primary", async () => "fallback")(input)).resolves.toBe("primary");
    await expect(headAskWithFallback(() => new Promise<string>(() => undefined), async () => "fallback", 10)(input)).resolves.toBe("fallback");
  });
});
