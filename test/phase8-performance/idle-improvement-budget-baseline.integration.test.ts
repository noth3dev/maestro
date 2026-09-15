import { describe, expect, it } from "vitest";
import { measureIdleImprovementBudgetBaseline } from "./idle-improvement-budget-baseline.js";

describe("Plan 8 §S5 idle improvement budget baseline", () => {
  it("records a provisional test-only budget without claiming a production idle consumer", async () => {
    const baseline = await measureIdleImprovementBudgetBaseline();

    expect(baseline.status).toBe("provisional-unimplemented");
    expect(baseline.productionIdleConsumer).toBe("unimplemented");
    expect(baseline.productBudgetDeclared).toBe(false);
    expect(baseline.fixture.scope).toBe("test-only");
    expect(baseline.fixture.simulationOnly).toBe(true);
    expect(baseline.fixture.consumedWorkUnits).toBeLessThanOrEqual(baseline.fixture.declaredWorkUnits);
    expect(baseline.fixture.yieldedBeforeEligibleGoal).toBe(true);
    expect(baseline.fixture.eligibilitySource).toBe("scripted-test-fixture");
    expect(baseline.fixture.authoritativeGoalRead).toBe(false);
    expect(baseline.fixture.timeBoundEnforced).toBe(false);
    expect(baseline.observations.every((observation) => observation.auditable)).toBe(true);
    expect(baseline.replay.status).toBe("compared");
    expect(baseline.replay.resultCount).toBe(1);
    expect(baseline.synthetic.status).toBe("completed");
    expect(baseline.synthetic.scenarioCount).toBe(8);
    expect(baseline.shadow.status).toBe("completed");
    expect(baseline.shadow.recordCount).toBe(1);
    expect(baseline.shadow.deniedEffects).toBe(1);
    expect(baseline.shadow.liveEffects).toBe(0);
    expect(baseline.shadow.journalEvents).toEqual(["started", "orphaned", "completed"]);
    expect(baseline.shadow.evidencePersistence).toBe("in-memory-test-sink");
    expect(baseline.shadow.committedEvidence).toBe(true);
    expect(baseline.shadow.committedCandidateContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(baseline.shadow.committedCandidateContentHash).toBe(baseline.candidateContentHash);
    expect(baseline.observations.every((observation) => observation.candidateContentHash === baseline.candidateContentHash)).toBe(true);
    expect(baseline.shadow.committedRunId).toBe("shadow-run-idle-budget-1");
    expect(baseline.observationDurability).toBe("in-memory-test-fixture");
    expect(baseline.durableAuditRecord).toBe(false);
    expect(baseline.providerCalls).toBe(0);
    expect(baseline.tokens).toBe(0);
    expect(baseline.cost).toBe(0);

    console.log(`PHASE8_PERFORMANCE_BASELINE ${JSON.stringify(baseline)}`);
  });
});
