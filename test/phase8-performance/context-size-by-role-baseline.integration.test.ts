import { describe, expect, it } from "vitest";
import { measureContextByRole } from "./context-size-by-role.js";

describe("Plan 8 §S5 context size by role baseline", () => {
  it("records the provider-facing context emitted by each model-turn role", async () => {
    const samples = await measureContextByRole();
    expect(samples.map((sample) => sample.role)).toEqual([
      "head",
      "worker",
      "team-lead-helper",
      "encore-reviewer",
      "semantic-reviewer",
      "conversation",
    ]);
    for (const sample of samples) {
      expect(sample.sampleCount).toBe(10);
      expect(sample.contextBytes.p50).toBeGreaterThan(0);
      expect(sample.contextBytes.p95).toBeGreaterThanOrEqual(sample.contextBytes.p50);
      expect(sample.contextBytes.max).toBeGreaterThanOrEqual(sample.contextBytes.p95);
    }
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify({ metric: "context-size-by-role", database: "runtime", samples })}`);
  });
});
