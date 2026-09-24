import { describe, expect, it, vi } from "vitest";
import type { IndependentBrief } from "@maestro/domain";
import {
  createHeadBriefRuntime,
  parseIndependentBriefText,
  HeadBriefParseError,
  HeadBriefProviderUnavailableError,
} from "./head-brief-runtime.js";
import type { ExecutionRef, InvocationObservation, ModelIdentity } from "@maestro/domain";

const brief: IndependentBrief = {
  interpretation: "safe outcome",
  contribution: "independent review",
  nonGoals: ["shipping changes"],
  assumptions: ["scope is fixed"],
  evidenceGaps: ["provider evidence"],
  risks: ["drift"],
  dependencies: ["contract"],
  proposedValidation: ["run tests"],
  expectedWorkers: ["reviewer"],
  expectedCost: "bounded",
  expectedTime: "short",
  objectionsToLikelyAlternatives: ["none"],
};

const model: ModelIdentity = { provider: "openai", id: "gpt-5.6-sol" };
const execution = "execution-head-product" as ExecutionRef;

function observation(overrides: Partial<InvocationObservation> = {}): InvocationObservation {
  return {
    invocation: "invocation-head-product" as never,
    name: "head:product",
    status: "succeeded",
    toolEvents: { state: "empty", events: [] },
    usage: { state: "unknown" },
    answer: { state: "available", text: JSON.stringify(brief) },
    ...overrides,
  };
}

describe("head brief runtime", () => {
  it("parses an exact IndependentBrief JSON object", () => {
    expect(parseIndependentBriefText(JSON.stringify(brief))).toEqual(brief);
  });

  it("rejects malformed, markdown-wrapped, unknown-field, and oversized output without echoing provider text", () => {
    for (const text of [
      "not json",
      `\`\`\`json\n${JSON.stringify(brief)}\n\`\`\``,
      JSON.stringify({ ...brief, secret: "do-not-echo" }),
      "x".repeat(65_000),
    ]) {
      expect(() => parseIndependentBriefText(text)).toThrow(HeadBriefParseError);
      try {
        parseIndependentBriefText(text);
      } catch (error) {
        expect(String(error)).not.toContain("do-not-echo");
        expect(String(error)).not.toContain(text.slice(0, 80));
      }
    }
  });

  it("observes and returns a validated brief with the exact provider/model identity", async () => {
    const kernel = {
      prompt: vi.fn(async () => undefined),
      getModelIdentity: vi.fn(async () => model),
      observe: vi.fn(async () => [observation()]),
    };
    const runtime = createHeadBriefRuntime({ kernel: kernel as never });

    await expect(runtime.run({ execution, prompt: "Produce only the required JSON object." })).resolves.toEqual({ brief, model });
    expect(kernel.prompt).toHaveBeenCalledWith(execution, "Produce only the required JSON object.");
    expect(kernel.getModelIdentity).toHaveBeenCalledWith(execution);
    expect(kernel.observe).toHaveBeenCalledWith(execution);
  });

  it("fails closed when the provider answer is unavailable, nonterminal, or empty", async () => {
    for (const item of [
      observation({ answer: { state: "unavailable", reason: "snapshot-unavailable" } }),
      observation({ status: "unknown" }),
      observation({ answer: { state: "available", text: "" } }),
    ]) {
      const kernel = {
        prompt: vi.fn(async () => undefined),
        getModelIdentity: vi.fn(async () => model),
        observe: vi.fn(async () => [item]),
      };
      await expect(createHeadBriefRuntime({ kernel: kernel as never }).run({ execution, prompt: "Produce JSON." })).rejects.toThrow(
        HeadBriefProviderUnavailableError,
      );
    }
  });
});
