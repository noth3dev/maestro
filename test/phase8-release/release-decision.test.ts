import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createBlockedScenarioReport } from "../../scripts/run-phase8-scenarios.mjs";
import { scenarioReportContentHash } from "../../test/phase8-scenarios/scenario-catalog.mjs";
import { evaluateReleaseDecision } from "../../scripts/release-decision.mjs";
import { runRollback } from "../../scripts/release-rollback.mjs";

function runDecisionCli(args, cwd = process.cwd()) {
  return new Promise((resolve) => execFile(process.execPath, ["scripts/release-decision.mjs", ...args], { cwd }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}

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


  it("rejects a live-shaped scenario report with a missing or mismatched content hash", () => {
    const report = { ...passedReport(), mode: "live-disposable", runId: "run-1", scenarios: passedReport().scenarios.map((scenario) => ({ ...scenario, limitations: ["bounded fixture"] })) };
    const input = { scenarioReport: report, gates: completeGates, findings: { critical: [], noncritical: [] }, supportedScope: ["disposable"], disabledCapabilities: ["external"], knownLimitations: ["workspace deps"], costs: { totalCents: 1 }, confidence: "not certified", dissent: [] };
    expect(evaluateReleaseDecision(input).blockers.join(" ")).toMatch(/hash/i);
    expect(evaluateReleaseDecision({ ...input, scenarioReport: { ...report, contentHash: "0".repeat(64) } }).blockers.join(" ")).toMatch(/hash/i);
  });

  it("binds every demonstrated gate to the same candidate, checkpoint, and run", () => {
    const reportBase = { ...passedReport(), mode: "live-disposable", runId: "run-1", scenarios: passedReport().scenarios.map((scenario) => ({ ...scenario, limitations: ["bounded fixture"] })) };
    const report = { ...reportBase, contentHash: scenarioReportContentHash(reportBase) };
    const result = evaluateReleaseDecision({
      scenarioReport: report, gates: completeGates, findings: { critical: [], noncritical: [] },
      gateManifest: { candidateId: "other-candidate", checkpointId: report.checkpointId, runId: report.runId, gateEvidence: Object.fromEntries(Object.keys(completeGates).map((gate) => [gate, "a".repeat(64)])) },
      supportedScope: ["disposable"], disabledCapabilities: ["external"], knownLimitations: ["workspace deps"], costs: { totalCents: 1 }, confidence: "bounded", dissent: [],
    });
    expect(result.status).toBe("blocked"); expect(result.blockers.join(" ")).toMatch(/candidateId/);
  });

  it("accepts the documented flat gate manifest through the CLI and binds it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-s10-cli-"));
    const reportPath = join(directory, "scenario-report.json"); const manifestPath = join(directory, "gates.json"); const outputPath = join(directory, "decision.json");
    const reportBase = { ...passedReport(), mode: "live-disposable", runId: "run-1", scenarios: passedReport().scenarios.map((scenario) => ({ ...scenario, limitations: ["bounded fixture"] })) };
    const report = { ...reportBase, contentHash: scenarioReportContentHash(reportBase) };
    await writeFile(reportPath, JSON.stringify(report));
    await writeFile(manifestPath, JSON.stringify({ candidateId: report.candidateId, checkpointId: report.checkpointId, runId: report.runId, scenarioReportHash: report.contentHash, gateEvidence: Object.fromEntries(Object.keys(completeGates).map((gate) => [gate, "a".repeat(64)])), gates: completeGates, findings: { critical: [], noncritical: [] }, supportedScope: ["disposable"], disabledCapabilities: ["external"], knownLimitations: ["workspace deps"], costs: { totalCents: 1 }, confidence: "bounded", dissent: [] }));
    const result = await runDecisionCli(["--scenario-report", reportPath, "--gate-manifest", manifestPath, "--report", outputPath]);
    expect(result.code).toBe(0); expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({ status: "approved", recommendation: "release" });
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
    const result = await runRollback({ disposableFixture: true, statePath, evidencePath, candidatePath, failurePath, reportPath, reruns: [
      { name: "failed scenario", command: process.execPath, args: [join(process.cwd(), "test/phase8-release/approved-rerun.mjs"), "failed scenario"] },
      { name: "phase gate", command: process.execPath, args: [join(process.cwd(), "test/phase8-release/approved-rerun.mjs"), "phase gate"] },
      { name: "full regression gate", command: process.execPath, args: [join(process.cwd(), "test/phase8-release/approved-rerun.mjs"), "full regression gate"] },
    ] });
    expect(result.status).toBe("rolled_back");
    expect(result.reruns.every((run) => run.exitCode === 0)).toBe(true);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state).toMatchObject({ releaseProgression: "stopped", externalAuthority: "disabled", improvementAuthority: "disabled", activeGoals: [{ id: "goal-1", state: "paused" }] });
    expect(result.preserved.candidate).toBeDefined();
    expect(result.preserved.evidence).toBeDefined();
  });

  it("rejects an unapproved rerun command before mutating rollback state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-s10-command-"));
    const statePath = join(directory, "state.json"); const evidencePath = join(directory, "evidence.json"); const candidatePath = join(directory, "candidate.json"); const failurePath = join(directory, "failure.json");
    await writeFile(statePath, JSON.stringify({ candidateId: "candidate-1", releaseProgression: "running", externalAuthority: "enabled", improvementAuthority: "enabled", activeGoals: [] }));
    await writeFile(evidencePath, "{}"); await writeFile(candidatePath, JSON.stringify({ candidateId: "candidate-1" })); await writeFile(failurePath, JSON.stringify({ status: "failed", scenarioId: "s", phaseGate: "G7" }));
    const result = await runRollback({ statePath, evidencePath, candidatePath, failurePath, reruns: [
      { name: "failed scenario", command: "/bin/sh", args: ["-c", "exit 0"] }, { name: "phase gate", command: process.execPath, args: ["-e", "process.exit(0)"] }, { name: "full regression gate", command: process.execPath, args: ["-e", "process.exit(0)"] },
    ] });
    expect(result.status).toBe("blocked");
    expect(JSON.parse(await readFile(statePath, "utf8")).releaseProgression).toBe("running");
  });

  it("rejects an approved command redirected to an untrusted working directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-s10-cwd-"));
    const statePath = join(directory, "state.json"); const evidencePath = join(directory, "evidence.json"); const candidatePath = join(directory, "candidate.json"); const failurePath = join(directory, "failure.json");
    await writeFile(statePath, JSON.stringify({ candidateId: "candidate-1", releaseProgression: "running", activeGoals: [] })); await writeFile(evidencePath, "{}"); await writeFile(candidatePath, JSON.stringify({ candidateId: "candidate-1" })); await writeFile(failurePath, JSON.stringify({ status: "failed", scenarioId: "s", phaseGate: "G7" }));
    const fixtureScript = join(process.cwd(), "test/phase8-release/approved-rerun.mjs");
    const reruns = ["failed scenario", "phase gate", "full regression gate"].map((name) => ({ name, command: process.execPath, args: [fixtureScript, name], cwd: "/tmp" }));
    const result = await runRollback({ disposableFixture: true, statePath, evidencePath, candidatePath, failurePath, reruns });
    expect(result.status).toBe("blocked"); expect(JSON.parse(await readFile(statePath, "utf8")).releaseProgression).toBe("running");
  });

  it("bounds approved reruns and records a timeout without hanging", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-s10-timeout-"));
    const statePath = join(directory, "state.json"); const evidencePath = join(directory, "evidence.json"); const candidatePath = join(directory, "candidate.json"); const failurePath = join(directory, "failure.json");
    await writeFile(statePath, JSON.stringify({ candidateId: "candidate-1", releaseProgression: "running", externalAuthority: "enabled", improvementAuthority: "enabled", activeGoals: [] }));
    await writeFile(evidencePath, "{}"); await writeFile(candidatePath, JSON.stringify({ candidateId: "candidate-1" })); await writeFile(failurePath, JSON.stringify({ status: "failed", scenarioId: "s", phaseGate: "G7" }));
    const fixtureScript = join(process.cwd(), "test/phase8-release/approved-rerun.mjs");
    const slow = { name: "failed scenario", command: process.execPath, args: [fixtureScript, "failed scenario"] };
    const quick = { name: "phase gate", command: process.execPath, args: [fixtureScript, "phase gate"] };
    const full = { name: "full regression gate", command: process.execPath, args: [fixtureScript, "full regression gate"] };
    const result = await runRollback({ disposableFixture: true, timeoutMs: 20, statePath, evidencePath, candidatePath, failurePath, reruns: [slow, quick, full] });
    expect(result.status).toBe("rollback_reruns_failed");
    expect(result.reruns[0]).toMatchObject({ timedOut: true, exitCode: null });
  });

  it("confines preserved rollback evidence and rejects path traversal in candidate identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-s10-path-"));
    const statePath = join(directory, "state.json"); const evidencePath = join(directory, "evidence.json"); const candidatePath = join(directory, "candidate.json"); const failurePath = join(directory, "failure.json");
    await writeFile(statePath, JSON.stringify({ candidateId: "../escape", releaseProgression: "running", activeGoals: [] })); await writeFile(evidencePath, "{}"); await writeFile(candidatePath, JSON.stringify({ candidateId: "../escape" })); await writeFile(failurePath, JSON.stringify({ status: "failed", scenarioId: "s", phaseGate: "G7" }));
    const result = await runRollback({ disposableFixture: true, statePath, evidencePath, candidatePath, failurePath, reruns: [] });
    expect(result.status).toBe("blocked"); expect(result.blockers.join(" ")).toMatch(/identity|path|segment/i);
  });

  it("refuses an existing symlink at a preserved evidence destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maestro-s10-symlink-"));
    const statePath = join(directory, "state.json"); const evidencePath = join(directory, "evidence.json"); const candidatePath = join(directory, "candidate.json"); const failurePath = join(directory, "failure.json"); const outside = join(directory, "outside.json"); const preservedDir = join(directory, "preserved");
    await writeFile(statePath, JSON.stringify({ candidateId: "candidate-1", releaseProgression: "running", activeGoals: [] })); await writeFile(evidencePath, "{}"); await writeFile(candidatePath, JSON.stringify({ candidateId: "candidate-1" })); await writeFile(failurePath, JSON.stringify({ status: "failed", scenarioId: "s", phaseGate: "G7" })); await writeFile(outside, "untouched");
    await mkdir(preservedDir); await symlink(outside, join(preservedDir, "candidate.json"));
    const fixtureScript = join(process.cwd(), "test/phase8-release/approved-rerun.mjs"); const reruns = ["failed scenario", "phase gate", "full regression gate"].map((name) => ({ name, command: process.execPath, args: [fixtureScript, name] }));
    const result = await runRollback({ disposableFixture: true, statePath, evidencePath, candidatePath, failurePath, preservedDir, reruns });
    expect(result.status).toBe("blocked"); expect(await readFile(outside, "utf8")).toBe("untouched");
  });
});
