import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_SCENARIO_IDS, REPRESENTATIVE_SCENARIOS, validateScenarioReport } from "./scenario-catalog.mjs";


function createPassedRecordFixture() {
  const blocked = {
    schemaVersion: 1,
    candidateId: "phase8-s9-disposable-candidate-v1",
    checkpointId: "phase8-s9-disposable-checkpoint-v1",
    status: "passed",
    scenarios: REPRESENTATIVE_SCENARIOS.map((scenario) => ({
      scenarioId: scenario.id, fixtureId: scenario.fixtureId, status: "passed", live: true,
      actors: ["actor"], models: ["model"], skills: ["skill"], tools: ["tool"], costs: {},
      actual: { actors: ["actor"], models: ["model"], skills: ["skill"], tools: ["tool"], costs: {} },
      injectedFailures: [], durableEvents: ["event"], durableEvidence: ["evidence"], expectedBehavior: scenario.expectedBehavior,
      observedBehavior: "observed", certifications: ["certified"], dissent: [], limitations: [], cleanup: scenario.cleanup,
    })),
    limitations: ["bounded fixture"],
  };
  return blocked;
}

describe("Plan 8 §S9 representative scenario contract", () => {
  it("defines all eleven executable scenarios with complete evidence fields", () => {
    expect(REPRESENTATIVE_SCENARIOS).toHaveLength(11);
    expect(REPRESENTATIVE_SCENARIOS.map((scenario) => scenario.id)).toEqual([...REQUIRED_SCENARIO_IDS]);
    for (const scenario of REPRESENTATIVE_SCENARIOS) {
      expect(scenario.fixtureId).toMatch(/^phase8-s9-/);
      expect(scenario.executable.command).toBe("npm");
      expect(scenario.executable.args.length).toBeGreaterThan(0);
      for (const target of scenario.executable.targets) expect(existsSync(join(process.cwd(), target)), target).toBe(true);
      expect(scenario.preconditions.length).toBeGreaterThan(0);
      expect(scenario.requiredRecordFields).toEqual(
        expect.arrayContaining([
          "actors",
          "models",
          "skills",
          "tools",
          "costs",
          "injectedFailures",
          "durableEvents",
          "durableEvidence",
          "expectedBehavior",
          "observedBehavior",
          "certifications",
          "dissent",
          "limitations",
          "cleanup",
        ]),
      );
    }
  });

  it("rejects a fabricated passed record without live runtime evidence", () => {
    const report = {
      schemaVersion: 1,
      candidateId: "phase8-s9-disposable-candidate-v1",
      checkpointId: "phase8-s9-disposable-checkpoint-v1",
      status: "passed",
      scenarios: REPRESENTATIVE_SCENARIOS.map((scenario) => ({
        scenarioId: scenario.id,
        fixtureId: scenario.fixtureId,
        status: "passed",
        live: false,
        actors: ["actor"],
        models: ["model"],
        skills: ["skill"],
        tools: ["tool"],
        costs: {},
        actual: { actors: ["actor"], models: ["model"], skills: ["skill"], tools: ["tool"], costs: {} },
        injectedFailures: [],
        durableEvents: ["event"],
        durableEvidence: ["evidence"],
        expectedBehavior: scenario.expectedBehavior,
        observedBehavior: "observed",
        certifications: [],
        dissent: [],
        limitations: [],
        cleanup: scenario.cleanup,
      })),
      limitations: [],
    };
    expect(() => validateScenarioReport(report)).toThrow(/live/);
  });

  it("rejects non-string actual runtime identities", () => {
    const report = createPassedRecordFixture();
    report.scenarios[0].actual.models = [null];
    expect(() => validateScenarioReport(report)).toThrow(/string array/);
  });

  it("requires Goal and Task Contract identity for a live passed record", () => {
    const base = createPassedRecordFixture();
    expect(() => validateScenarioReport(base)).toThrow(/Goal|Task Contract|preconditions/i);
  });

  it("requires blocked fixture reports to state that live acceptance is pending", () => {
    const report = {
      schemaVersion: 1,
      candidateId: "phase8-s9-disposable-candidate-v1",
      checkpointId: "phase8-s9-disposable-checkpoint-v1",
      status: "blocked",
      scenarios: REPRESENTATIVE_SCENARIOS.map((scenario) => ({
        scenarioId: scenario.id,
        fixtureId: scenario.fixtureId,
        status: "not-run",
        live: false,
        actors: [],
        models: [],
        skills: [],
        tools: [],
        costs: null,
        actual: { actors: [], models: [], skills: [], tools: [], costs: null },
        injectedFailures: [],
        durableEvents: [],
        durableEvidence: [],
        expectedBehavior: scenario.expectedBehavior,
        observedBehavior: null,
        certifications: [],
        dissent: [],
        limitations: ["live acceptance is pending"],
        cleanup: scenario.cleanup,
      })),
      limitations: ["live acceptance is pending"],
    };
    expect(() => validateScenarioReport(report)).not.toThrow();
  });
});
