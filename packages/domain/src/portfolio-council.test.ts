import { describe, expect, it } from "vitest";
import { MODEL_CAPABILITY_AXES, type ModelCapabilityVector, type TaskDemand } from "./index.js";
import { decidePortfolioCouncil, type PortfolioCouncilInput } from "./portfolio-council.js";

const demand = (level = 80): TaskDemand => ({
  schemaVersion: 1,
  taskKinds: ["coding"],
  requirements: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { level, rationale: "Head requirement" }])),
  provenance: { taskContractRef: "contract-1", headDecisionRef: "head-decision-1" },
});
const routing = (score = 180): { modelRef: string; capability: ModelCapabilityVector } => ({
  modelRef: "provider/model",
  capability: { schemaVersion: 2, axes: Object.fromEntries(MODEL_CAPABILITY_AXES.map((axis) => [axis, { status: "scored", score, rationale: "verified", evidence: ["evidence-model"] }])) } as ModelCapabilityVector,
});
const base = (overrides: Partial<PortfolioCouncilInput> = {}): PortfolioCouncilInput => ({
  councilId: "council-1",
  commandId: "command-1",
  trigger: "capacity_conflict",
  goals: [{ goalId: "goal-1", projectId: "project-1", priority: 10, ceoPinned: false, pressure: 120, taskDemand: demand(), currentRouting: routing(), approvedCeiling: { providerRate: 100, spendCents: 1000, workerSlots: 4 }, currentAllocation: { providerRate: 10, spendCents: 100, workerSlots: 1 }, safePausePoint: "effect-boundary-1" }],
  actions: [{ goalId: "goal-1", disposition: "continue", order: 1, allocation: { providerRate: 20, spendCents: 200, workerSlots: 1 }, rationale: "keep the required model progressing", executionFence: { previousExecutionRef: "execution-1", previousFencingToken: "fence-old", nextFencingToken: "fence-new" } }],
  evidenceReferences: ["evidence-capacity-1"],
  dissent: [],
  confidence: 0.9,
  reconsiderationTriggers: ["capacity-recovered"],
  ...overrides,
});

describe("portfolio council decision policy", () => {
  it("records an evidence-backed decision for a capacity conflict", () => {
    const decision = decidePortfolioCouncil(base());
    expect(decision.status).toBe("decided");
    expect(decision.executionDisposition).toBe("executable");
    expect(decision.evidenceReferences).toEqual(["evidence-capacity-1"]);
  });

  it("allows reorder, pause, and reallocation within approved ceilings", () => {
    expect(decidePortfolioCouncil(base({ actions: [{ ...base().actions[0]!, disposition: "pause" }] })).actions[0]!.disposition).toBe("pause");
    expect(decidePortfolioCouncil(base({ actions: [{ ...base().actions[0]!, order: 0, allocation: { providerRate: 30, spendCents: 300, workerSlots: 2 } }] })).actions[0]!.order).toBe(0);
    expect(() => decidePortfolioCouncil(base({ actions: [{ ...base().actions[0]!, allocation: { providerRate: 101, spendCents: 100, workerSlots: 1 } }] }))).toThrow(/approved ceiling/i);
  });

  it("escalates rather than authorizing a model below the Goal A↔D requirement", () => {
    const decision = decidePortfolioCouncil(base({ goals: [{ ...base().goals[0]!, pressure: 180, currentRouting: routing(40) }] }));
    expect(decision.status).toBe("escalated");
    expect(decision.executionDisposition).toBe("non_executable");
    expect(decision.routingEscalations[0]!.band).toBe("critical");
  });

  it("never pauses or deprioritizes a CEO-pinned Goal", () => {
    expect(() => decidePortfolioCouncil(base({ goals: [{ ...base().goals[0]!, ceoPinned: true }], actions: [{ ...base().actions[0]!, disposition: "pause" }] }))).toThrow(/CEO-pinned/);
  });

  it("gives a Discord safety preemption precedence over a Council decision", () => {
    const decision = decidePortfolioCouncil(base({ discordPreemption: { incidentId: "incident-1", goalId: "goal-1", severity: "critical", confidence: 0.99, reason: "safety event" } }));
    expect(decision.precedence).toBe("discord_safety_preemption");
    expect(decision.actions[0]!.disposition).toBe("preempt");
    expect(decision.evidenceReferences).toContain("evidence-capacity-1");
  });

  it("keeps council evidence append-only in the decision packet and carries the old execution fence", () => {
    const decision = decidePortfolioCouncil(base());
    expect(decision.actions[0]!.executionFence).toEqual({ previousExecutionRef: "execution-1", previousFencingToken: "fence-old", nextFencingToken: "fence-new" });
    expect(decision.evidenceReferences).toEqual(["evidence-capacity-1"]);
  });
});
