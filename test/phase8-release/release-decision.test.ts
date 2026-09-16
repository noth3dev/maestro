import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBlockedScenarioReport } from "../../scripts/run-phase8-scenarios.mjs";
import { evaluateReleaseDecision } from "../../scripts/release-decision.mjs";
import { runRollback } from "../../scripts/release-rollback.mjs";

const completeGates = {
  phaseExitGates: true,
  liveScenarios: true,
  zeroCriticalFindings: true,
  noncriticalFindingsOwnedScheduled: true,
  backupRestore: true,
  personaRollback: true,
  criticalActionDenial: true,
  documentation: true,
  councilConfidenceDissent: true,
};

function passedReport() {
  const blocked = createBlockedScenarioReport();
  return {
    ...blocked,
    status: "passed",
    scenarios: blocked.scenarios.map((scenario) => ({
      ...scenario,
      status: "passed",
      live: true,
      actors: ["actor"], models: ["model"], skills: ["skill"], tools: ["tool"], costs: { totalCents: 1 },
      actual: { actors: ["actor"], models: ["model"], skills: ["skill"], tools: ["tool"], costs: { totalCents: 1 } },
      preconditions: ["disposable fixture ready"], goalId: "goal-1", taskContractVersion: "1",
      durableEvents: ["event"], durableEvidence: ["evidence"], observedBehavior: "observed", certifications: ["certified"],
    })),
    limitations: ["bounded disposable fixture"],
  };
}

describe("Plan 8 §S10 release decision", () => {
  it("refuses release when S9 is blocked even when every other gate is marked true", () => {
    const result = evaluateReleaseDecision({ scenarioReport: createBlockedScenarioReport(), gates: completeGates, findings: { critical: [], noncritical: [] } });
    expect(result.status).toBe("blocked");
    expect(result.recommendation).toBe("do_not_release");
    expect(result.blockers.join(" ")).toMatch(/scenario|live|S9/i);
  });

  it("never accepts a critical finding override", () => {
    const result = evaluateReleaseDecision({ scenarioReport: passedReport(), gates: { ...completeGates, zeroCriticalFindings: false }, findings: { critical: [{ id: "critical-1" }], noncritical: [] }, allowCritical: true });
    expect(result.status).toBe("blocked");
    expect(result.recommendation).toBe("do_not_release");
    expect(result.blockers.join(" ")).toMatch(/critical/i);
  });

  it("requires real report metadata before producing the final release report", () => {
    const result = evaluateReleaseDecision({ scenarioReport: passedReport(), gates: completeGates, findings: { critical: [], noncritical: [] } });
    expect(result.status).toBe("blocked");
    expect(result.blockers.join(" ")).toMatch(/scope|limitation|cost|confidence|dissent/i);
  });
});

describe("Plan 8 §S10 rollback protocol", () => {
  it("preserves candidate/evidence, disables authority, pauses goals, and reruns all gates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-s10-"));
    const statePath = join(directory, "state.json");
    const evidencePath = join(directory, "evidence.json");
    const candidatePath = join(directory, "candidate.json");
    const failurePath = join(directory, "failure.json");
    const reportPath = join(directory, "rollback-report.json");
    await writeFile(statePath, JSON.stringify({ candidateId: "candidate-1", releaseProgression: "running", externalAuthority: "enabled", improvementAuthority: "enabled", activeGoals: [{ id: "goal-1", state: "active" }] }));
    await writeFile(evidencePath, JSON.stringify({ scenario: "07-encore-improvement", events: ["failed"] }));
    await writeFile(candidatePath, JSON.stringify({ candidateId: "candidate-1", version: 1 }));
    await writeFile(failurePath, JSON.stringify({ status: "failed", scenarioId: "07-encore-improvement", phaseGate: "G7", critical: false }));
    const result = await runRollback({ statePath, evidencePath, candidatePath, failurePath, reportPath, reruns: [
      { name: "failed scenario", command: process.execPath, args: ["-e", "process.exit(0)"] },
      { name: "phase gate", command: process.execPath, args: ["-e", "process.exit(0)"] },
      { name: "full regression gate", command: process.execPath, args: ["-e", "process.exit(0)"] },
    ] });
    expect(result.status).toBe("rolled_back");
    expect(result.reruns.every((run) => run.exitCode === 0)).toBe(true);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state).toMatchObject({ releaseProgression: "stopped", externalAuthority: "disabled", improvementAuthority: "disabled", activeGoals: [{ id: "goal-1", state: "paused" }] });
    expect(result.preserved.candidate).toBeDefined();
    expect(result.preserved.evidence).toBeDefined();
  });
});
