import { describe, expect, it } from "vitest";
import { assertValidImprovementDigestInput, improvementDigestContentHash, type ImprovementDigestInput } from "./improvement-digest.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";
const digest = (overrides: Partial<ImprovementDigestInput> = {}): ImprovementDigestInput => ({
  schemaVersion: 1, projectId: PROJECT_ID, goalId: GOAL_ID, episodeId: "goal-completion", trigger: "goal_completed",
  situation: "A completed Goal produced a measurable outcome.",
  selectedDecision: "Use the bounded local pipeline.",
  rejectedAlternatives: ["Use an unbounded provider loop."],
  observedResult: "The Goal completed with all required checks.",
  metrics: [{ name: "completion_latency_ms", value: 1200, unit: "ms" }],
  confidence: 0.8, sourceRefs: [{ kind: "goal", sourceId: GOAL_ID }], ...overrides,
});

describe("Improvement Digest contract", () => {
  it("accepts bounded curated evidence and hashes the canonical content deterministically", () => {
    const value = digest();
    expect(() => assertValidImprovementDigestInput(value)).not.toThrow();
    expect(improvementDigestContentHash(value)).toBe(improvementDigestContentHash({ ...value, rejectedAlternatives: [...value.rejectedAlternatives] }));
  });

  it("normalizes case-insensitive UUIDs before canonical hashing", () => {
    const value = digest();
    const uppercase = { ...value, projectId: value.projectId.toUpperCase(), goalId: value.goalId.toUpperCase(), sourceRefs: [{ kind: "goal" as const, sourceId: value.goalId.toUpperCase() }] };
    expect(improvementDigestContentHash(uppercase)).toBe(improvementDigestContentHash(value));
  });

  it("rejects secret-like summaries, invalid confidence, duplicate sources, and unbounded fields", () => {
    expect(() => assertValidImprovementDigestInput(digest({ confidence: 1.1 }))).toThrow();
    expect(() => assertValidImprovementDigestInput(digest({ situation: "sk-proj-12345678901234567890" }))).toThrow();
    expect(() => assertValidImprovementDigestInput(digest({ observedResult: "AKIA1234567890ABCDEF" }))).toThrow();
    expect(() => assertValidImprovementDigestInput(digest({ schemaVersion: 2 as never }))).toThrow();
    expect(() => assertValidImprovementDigestInput(digest({ situation: "Authorization: Bearer secret-token" }))).toThrow();
    expect(() => assertValidImprovementDigestInput(digest({ sourceRefs: [{ kind: "goal", sourceId: GOAL_ID }, { kind: "goal", sourceId: GOAL_ID }] }))).toThrow();
    const caseVariantId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    expect(() => assertValidImprovementDigestInput(digest({ sourceRefs: [{ kind: "goal", sourceId: caseVariantId }, { kind: "goal", sourceId: caseVariantId.toUpperCase() }] }))).toThrow("unique");
    expect(() => assertValidImprovementDigestInput(digest({ metrics: Array.from({ length: 17 }, (_, index) => ({ name: `m${index}`, value: index, unit: "count" })) }))).toThrow();
  });

  it("accepts the documented maximum alternative list without an extra aggregate cap", () => {
    expect(() => assertValidImprovementDigestInput(digest({ rejectedAlternatives: Array.from({ length: 16 }, () => "a".repeat(4096)) }))).not.toThrow();
  });

  it("rejects an autonomous digest trigger outside the reviewed milestone set", () => {
    expect(() => assertValidImprovementDigestInput(digest({ trigger: "candidate_applied" as never }))).toThrow();
  });

  it("requires durable UUID references and numbers with stable JSON encoding", () => {
    expect(() => assertValidImprovementDigestInput(digest({ sourceRefs: [{ kind: "goal", sourceId: "goal-1" }] }))).toThrow("UUID");
    expect(() => assertValidImprovementDigestInput(digest({ metrics: [{ name: "ratio", value: 1e-7, unit: "ratio" }] }))).toThrow("stable");
    expect(() => assertValidImprovementDigestInput(digest({ confidence: 1e-7 }))).toThrow("stable");
  });
});
