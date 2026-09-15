import { describe, expect, it } from "vitest";
import { measureRadialGraphLargePortfolio } from "./radial-graph-large-portfolio-baseline.js";

describe("Plan 8 §S5 radial graph behavior under a large portfolio", () => {
  it("records layout cost and preserves the complete projection behavior", () => {
    const baseline = measureRadialGraphLargePortfolio();
    expect(baseline.sampleCount).toBe(10);
    expect(baseline.layoutMs.p50).toBeGreaterThanOrEqual(0);
    expect(baseline.layoutMs.p95).toBeGreaterThanOrEqual(baseline.layoutMs.p50);
    expect(baseline.layoutMs.max).toBeGreaterThanOrEqual(baseline.layoutMs.p95);
    expect(baseline.portfolio.goals).toBe(24);
    expect(baseline.portfolio.sectorsPerGoal).toBe(5);
    expect(baseline.portfolio.workersPerSector).toBe(2);
    expect(baseline.portfolio.sourceNodes).toBe(384);
    expect(baseline.behavior.virtualizedFlagSamples).toBe(10);
    expect(baseline.behavior.sourceIdentityPreserved).toBe(true);
    expect(baseline.behavior.criticalBlockersRetained).toBe(true);
    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
  });
});
