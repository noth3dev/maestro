import { describe, expect, it } from "vitest";
import {
  assertImprovementClassEnabled,
  assertBoundedRolloutScope,
  evaluateProtectedMetrics,
  reconcileInterruptedRollout,
  type RolloutProtectedMetric,
  type RolloutScope,
  type InterruptedRolloutState,
} from "./rollout-controller.js";

describe("bounded rollout controller", () => {
  const scope: RolloutScope = {
    roleId: "head-engineering",
    taskClass: "implementation",
    maxGoalCount: 3,
    windowStart: "2026-09-14T00:00:00.000Z",
    windowEnd: "2026-09-15T00:00:00.000Z",
  };

  it("requires explicit enablement for exactly one improvement class", () => {
    expect(() => assertImprovementClassEnabled("persona_axis", [])).toThrow(/enabled|class/i);
    expect(() => assertImprovementClassEnabled("persona_axis", ["routing_capability_axis"])).toThrow(/enabled|class/i);
    expect(() => assertImprovementClassEnabled("persona_axis", ["persona_axis"])).not.toThrow();
  });

  it("accepts only a fixed, bounded role/task scope and rejects widening", () => {
    expect(assertBoundedRolloutScope(scope)).toEqual(scope);
    expect(() => assertBoundedRolloutScope({ ...scope, maxGoalCount: 0 })).toThrow(/goal|bound/i);
    expect(() => assertBoundedRolloutScope({ ...scope, windowEnd: scope.windowStart })).toThrow(/window|time/i);
    expect(() => assertBoundedRolloutScope({ ...scope, roleId: "" })).toThrow(/role|scope/i);
  });

  it("returns an automatic rollback decision when a protected metric regresses", () => {
    const protectedMetrics: readonly RolloutProtectedMetric[] = [
      { name: "correctness", minimum: 0.9 },
      { name: "latency_ms", maximum: 500 },
    ];
    expect(evaluateProtectedMetrics(protectedMetrics, [
      { name: "correctness", value: 0.84 },
      { name: "latency_ms", value: 400 },
    ])).toEqual({ decision: "rollback", violatedMetrics: ["correctness"] });
    expect(evaluateProtectedMetrics(protectedMetrics, [
      { name: "correctness", value: 0.95 },
      { name: "latency_ms", value: 400 },
    ])).toEqual({ decision: "continue", violatedMetrics: [] });
  });

  it("reconciles an interrupted rollout to its last certified predecessor", () => {
    const interrupted: InterruptedRolloutState = {
      status: "interrupted",
      activeCandidateId: "11111111-1111-4111-8111-111111111111",
      activeVersion: 2,
      lastCertifiedCandidateId: "22222222-2222-4222-8222-222222222222",
      lastCertifiedVersion: 1,
      rollbackTarget: {
        candidateId: "22222222-2222-4222-8222-222222222222",
        version: 1,
        contentHash: "a".repeat(64),
      },
    };
    expect(reconcileInterruptedRollout(interrupted)).toEqual({
      status: "rolled_back",
      activeCandidateId: interrupted.rollbackTarget.candidateId,
      activeVersion: interrupted.rollbackTarget.version,
      rollbackTarget: interrupted.rollbackTarget,
    });
  });
});
