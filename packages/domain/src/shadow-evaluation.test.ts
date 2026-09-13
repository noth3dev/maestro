import { describe, expect, it } from "vitest";
import { improvementCandidateScenarioSuiteHash, type ImprovementCandidateInput } from "./improvement-candidate.js";
import {
  createShadowAuthorityBoundary,
  createShadowKernelPort,
  runShadowEvaluation,
  type ShadowOutput,
} from "./shadow-evaluation.js";
import type { ExecutionKernelPort } from "./execution-kernel.js";
import { runShadowEvaluation as exportedRunShadowEvaluation } from "./index.js";

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
const input = { request: "review the change" };
const sameInput = () => ({ input, activeInput: input, active });
let runCounter = 0;
const journalConfig = (events: string[] = [], outcomes: string[] = []) => ({
  journal: { append: async (event: { event: string }) => { events.push(event.event); } },
  resultSink: { record: async (result: { status: string }) => { outcomes.push(result.status); } },
  runId: `shadow-run-${++runCounter}`,
  processRef: `shadow-process-${runCounter}`,
  sessionId: `shadow-session-${runCounter}`,
  processPid: 4321,
});

describe("zero-authority shadow evaluation", () => {
  it("records proposed messages, plans, and challenges against the active persona on identical input", async () => {
    const completedEvents: string[] = [];
    const outcomes: string[] = [];
    const result = await runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(completedEvents, outcomes),
      cases: [sameInput()],
      evaluate: async (receivedInput) => ({ ...active, messages: [`shadow:${(receivedInput as typeof input).request}`] }),
    });
    expect(result.status).toBe("completed");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ input, active, proposed: { plans: active.plans, challenges: active.challenges } });
    expect(result.records[0]!.compared).toBe(true);
    expect(result.records[0]!.matchesActive).toBe(false);
    expect(completedEvents).toEqual(["started"]);
    expect(outcomes).toEqual(["completed"]);
    expect(exportedRunShadowEvaluation).toBe(runShadowEvaluation);
  });

  it("rejects an invalid candidate before starting its lifecycle journal", async () => {
    const events: string[] = [];
    await expect(runShadowEvaluation({
      candidate: { ...candidate(), confidence: Number.NaN },
      ...journalConfig(events),
      cases: [sameInput()],
      evaluate: async () => active,
    })).rejects.toThrow(/finite|candidate/i);
    expect(events).toEqual([]);
  });

  it("rejects class instances and other non-JSON input before cloning", async () => {
    class MutableInput { constructor(readonly request: string) {} }
    await expect(runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(),
      cases: [{ input: new MutableInput("one"), activeInput: new MutableInput("one"), active }],
      evaluate: async () => active,
    })).rejects.toThrow(/plain JSON|JSON data/i);
  });

  it("rejects a shadow case whose active output was not produced from the identical input", async () => {
    await expect(runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(),
      cases: [{ input: { request: "one" }, activeInput: { request: "two" }, active }],
      evaluate: async () => active,
    })).rejects.toThrow(/inputs differ/i);
  });

  it("denies an effect attempt before any AuthorizedEffectExecutor or live effect is reached", async () => {
    let executorCalls = 0;
    let liveEffectRows = 0;
    const authority = createShadowAuthorityBoundary({ execute: async () => { executorCalls += 1; return { effect: "allow" }; } });
    await expect(authority.attemptEffect({ action: "project.file.write", target: "/repo/file" }, async () => { liveEffectRows += 1; })).rejects.toThrow(/shadow|authority/i);
    expect(executorCalls).toBe(0);
    expect(liveEffectRows).toBe(0);

    const result = await runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(),
      cases: [sameInput()],
      evaluate: async (_input, context) => {
        await expect(context.attemptEffect({ action: "project.file.write", target: "/repo/file" }, async () => { liveEffectRows += 1; })).rejects.toThrow(/shadow|authority/i);
        return active;
      },
    });
    expect(result.deniedEffects).toHaveLength(1);
    expect(executorCalls).toBe(0);
    expect(liveEffectRows).toBe(0);
  });

  it("exposes recorded evidence only, with no Goal, budget, or authority state reader", async () => {
    let evidenceReads = 0;
    const result = await runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(),
      cases: [sameInput()],
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

  it("deep-freezes evaluator inputs, evidence, and returned nested records", async () => {
    const evidence = { nested: { value: "observed" } };
    let receivedInput: unknown;
    const result = await runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(),
      cases: [sameInput()],
      recordedEvidence: { "evidence-1": evidence },
      evaluate: async (received, context) => {
        receivedInput = received;
        expect(Object.isFrozen(context)).toBe(true);
        const observed = context.readRecordedEvidence("evidence-1") as { nested: { value: string } };
        expect(Object.isFrozen(received)).toBe(true);
        expect(Object.isFrozen(observed)).toBe(true);
        expect(Object.isFrozen(observed.nested)).toBe(true);
        return { ...active, plans: [{ nested: { value: "shadow" } }] };
      },
    });
    expect(Object.isFrozen(receivedInput)).toBe(true);
    expect(Object.isFrozen(result.records[0]!.proposed.plans[0])).toBe(true);
    expect(Object.isFrozen((result.records[0]!.proposed.plans[0] as { nested: object }).nested)).toBe(true);
  });

  it("marks evaluator failure as orphaned instead of leaving a started-only run", async () => {
    const events: string[] = [];
    await expect(runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(events),
      cases: [sameInput()],
      evaluate: async () => { throw new Error("provider disconnected"); },
    })).rejects.toThrow("provider disconnected");
    expect(events).toEqual(["started", "orphaned"]);
  });

  it("rejects sparse case arrays before starting the journal", async () => {
    const events: string[] = [];
    const cases = [] as ReturnType<typeof sameInput>[];
    cases.length = 1;
    await expect(runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(events),
      cases,
      evaluate: async () => active,
    })).rejects.toThrow(/sparse/i);
    expect(events).toEqual([]);
  });

  it("provides a read-only kernel facade with no provider write methods", async () => {
    const kernel = {
      spawn: async () => ({ execution: "execution" as never, invocation: "invocation" as never }),
      prompt: async () => undefined,
      observe: async () => [],
      sendMessage: async () => undefined,
      cancel: async () => ({ cancelled: true }),
      getModelIdentity: async () => ({ provider: "test", id: "test" }),
      getToolEvents: async () => ({ state: "empty", events: [] as const }),
      getUsage: async () => ({ state: "unknown" as const }),
      getInvocationStatus: async () => "unknown" as const,
      resume: async () => { throw new Error("unused"); },
      reconnect: async () => { throw new Error("unused"); },
    } satisfies Partial<ExecutionKernelPort>;
    const facade = createShadowKernelPort(kernel as ExecutionKernelPort);
    expect(facade).toEqual(expect.objectContaining({ observe: expect.any(Function), getToolEvents: expect.any(Function), getUsage: expect.any(Function), getInvocationStatus: expect.any(Function) }));
    expect(facade).not.toHaveProperty("spawn");
    expect(facade).not.toHaveProperty("prompt");
    expect(facade).not.toHaveProperty("sendMessage");
    expect(facade).not.toHaveProperty("cancel");

    let contextKernel: unknown;
    await runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(),
      cases: [sameInput()],
      kernel: kernel as ExecutionKernelPort,
      evaluate: async (_input, context) => { contextKernel = context.kernel; return active; },
    });
    expect(contextKernel).toEqual(expect.objectContaining({ observe: expect.any(Function) }));
    expect(contextKernel).not.toHaveProperty("spawn");
    expect(contextKernel).not.toHaveProperty("prompt");
  });

  it("journals an interrupted run as orphaned and commits no partial live effect", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const result = await runShadowEvaluation({
      candidate: candidate(),
      ...journalConfig(events),
      signal: controller.signal,
      cases: [sameInput(), { input: { request: "second" }, activeInput: { request: "second" }, active }],
      evaluate: async (receivedInput) => {
        if ((receivedInput as { request: string }).request === "review the change") controller.abort();
        return active;
      },
    });
    expect(result.status).toBe("interrupted");
    expect(result.records).toHaveLength(0);
    expect(result.liveEffects).toEqual([]);
    expect(events).toEqual(["started", "orphaned"]);
  });
});
