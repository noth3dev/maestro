import { describe, expect, it } from "vitest";
import { improvementCandidateScenarioSuiteHash, type ImprovementCandidateInput } from "./improvement-candidate.js";
import { runShadowEvaluation, type ShadowOutput } from "./shadow-evaluation.js";

const candidate = (): ImprovementCandidateInput => ({
  schemaVersion: 1,
  projectId: "11111111-1111-4111-8111-111111111111",
  goalId: "22222222-2222-4222-8222-222222222222",
  kind: "persona_axis",
  target: { roleId: "head-engineering", taskClass: "implementation" },
  changes: [{ axis: "caution", currentValue: 0.7, proposedValue: 0.76 }],
  sourceEvidenceIds: ["33333333-3333-4333-8333-333333333333"],
  evidencePattern: "Repeated risk-review omissions.",
  predictedEffect: "Surface reversible-risk checks earlier.",
  expectedMetrics: [{ name: "useful_risk_findings", unit: "count", direction: "increase", target: 1 }],
  protectedMetrics: [{ name: "correctness", unit: "score", minimum: 0.9, maximum: 1 }],
  scenarioSuite: ["shadow-risk-review-v1"],
  scenarioSuiteHash: improvementCandidateScenarioSuiteHash(["shadow-risk-review-v1"]),
  confidence: 0.84,
  dataSufficiency: { episodeCount: 3, comparableGoalCount: 2 },
  rollbackTarget: { candidateId: "44444444-4444-4444-8444-444444444444", version: 1, contentHash: "0".repeat(64) },
});

const active: ShadowOutput = {
  messages: ["I will inspect the diff before proposing a change."],
  plans: [{ step: "inspect" }],
  challenges: [{ kind: "risk-review" }],
};

describe("zero-authority shadow evaluation", () => {
  it("records proposed messages, plans, and challenges against the active persona on identical input", async () => {
    const input = { request: "review the change" };
    const result = await runShadowEvaluation({
      candidate: candidate(),
      cases: [{ input, active }],
      evaluate: async (receivedInput) => ({ ...active, messages: [`shadow:${(receivedInput as typeof input).request}`] }),
    });
    expect(result.status).toBe("completed");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ input, active, proposed: { plans: active.plans, challenges: active.challenges } });
    expect(result.records[0]!.compared).toBe(true);
  });

  it("denies an effect attempt before any AuthorizedEffectExecutor or live effect is reached", async () => {
    let executorCalls = 0;
    let liveEffectRows = 0;
    const result = await runShadowEvaluation({
      candidate: candidate(),
      cases: [{ input: { request: "write" }, active }],
      authorityExecutor: { execute: async () => { executorCalls += 1; return { effect: "allow" }; } },
      evaluate: async (_input, context) => {
        await expect(context.attemptEffect({ action: "project.file.write", target: "/repo/file" }, async () => { liveEffectRows += 1; })).rejects.toThrow(/shadow|authority/i);
        return active;
      },
    });
    expect(result.status).toBe("completed");
    expect(result.deniedEffects).toHaveLength(1);
    expect(executorCalls).toBe(0);
    expect(liveEffectRows).toBe(0);
  });

  it("exposes recorded evidence only, with no Goal, budget, or authority state reader", async () => {
    let evidenceReads = 0;
    const result = await runShadowEvaluation({
      candidate: candidate(),
      cases: [{ input: { request: "inspect" }, active }],
      recordedEvidence: { "evidence-1": { kind: "test-result", content: "observed" } },
      evaluate: async (_input, context) => {
        expect(Object.keys(context).sort()).toEqual(["attemptEffect", "readRecordedEvidence"]);
        expect(context.readRecordedEvidence("evidence-1")).toEqual({ kind: "test-result", content: "observed" });
        evidenceReads += 1;
        return active;
      },
    });
    expect(result.status).toBe("completed");
    expect(evidenceReads).toBe(1);
    expect(result.records[0]!.readEvidenceIds).toEqual(["evidence-1"]);
  });

  it("interrupts without committing partial live effects when a shadow run is cancelled", async () => {
    const controller = new AbortController();
    const result = await runShadowEvaluation({
      candidate: candidate(),
      signal: controller.signal,
      cases: [
        { input: { request: "first" }, active },
        { input: { request: "second" }, active },
      ],
      evaluate: async (input) => {
        if ((input as { request: string }).request === "first") controller.abort();
        return active;
      },
    });
    expect(result.status).toBe("interrupted");
    expect(result.records).toHaveLength(0);
    expect(result.liveEffects).toEqual([]);
  });
});
