import { describe, expect, it } from "vitest";
import { renderTaskContractPanel } from "./task-contract-panel.js";
import { renderCouncilPanel } from "./council-panel.js";
import { renderDepartmentPlanPanel } from "./department-plan-panel.js";
import { renderWorkerPanel } from "./worker-panel.js";
import { renderMetronomePanel } from "./metronome-panel.js";
import { renderEncorePanel } from "./encore-panel.js";
import { renderCertificationPanel } from "./certification-panel.js";
import { renderBudgetPanel } from "./budget-panel.js";

const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const hash = (n: number) => String(n).repeat(64);

const contract = {
  contractId: id(1), schemaVersion: 1 as const, version: 3, contentHash: hash(1), launchState: "launched" as const,
  desiredOutcome: "ship the read surface", userVisibleBehavior: ["show durable content"], successCriteria: ["operators can inspect it"], liveEvidence: ["evidence-1"],
  scope: ["TUI"], nonGoals: ["new routes"], priorities: ["truth"], acceptableTradeoffs: ["compact output"], constraints: ["existing API"], knownEdgeCases: ["missing optional read data"],
  project: { projectId: id(2), repository: "repo", immutableBaseRevision: "abc", dataBoundary: "project" }, evidenceReferences: ["evidence-1"], approvedPreviewReferences: [], expectedGroups: ["group"], expectedDepartments: ["engineering"], criticalActionExpectations: ["none"], forbiddenEffects: ["none"], environmentAssumptions: ["none"], externalServiceAssumptions: ["none"],
  budget: { ceiling: "100 cents", reportingExpectations: ["daily"], stoppingConditions: ["budget" ] }, decisionHistory: [{ decisionId: id(3), kind: "created" as const, evidence: { source: "test" } }],
};

describe("read-depth panels", () => {
  it("renders Task Contract substance, hash, and version history already carried by the route", () => {
    const lines = renderTaskContractPanel({ kind: "value", value: contract }, 240);
    expect(lines.join("\n")).toContain("ship the read surface");
    expect(lines.join("\n")).toContain(`content hash: ${hash(1)}`);
    expect(lines.join("\n")).toContain(`created · ${id(3)}`);
  });

  it("renders Council participants and decision packet while stating that briefs are not in the route record", () => {
    const council = { councilId: id(4), goalId: id(5), contractId: id(1), briefDeadline: "2030-01-01T00:00:00.000Z", state: "resolved" as const, noNewEvidenceStreak: 0, decisionPacket: { outcome: "decided", selectedDirection: "ship", dissent: ["risk"], evidenceReferences: ["evidence-1"] }, snapshotHash: hash(4), snapshot: { participants: [{ participantId: "head:engineering", headRoleId: "head:engineering", departmentId: "engineering", sessionRef: "session-1" }] } };
    const lines = renderCouncilPanel({ kind: "value", value: council }, 240).join("\n");
    expect(lines).toContain("engineering");
    expect(lines).toContain("selectedDirection");
    expect(lines).toContain("Briefs unavailable from Head Council route response.");
  });

  it("renders Department Plan substance and is explicit that revision history is absent", () => {
    const plan = { projectId: id(2), goalId: id(5), councilId: id(4), councilSnapshotHash: hash(4), decisionPacketHash: hash(5), contractId: id(1), contractVersion: 3, contractContentHash: hash(1), departmentId: "engineering", headRoleId: "head:engineering", version: 2, contentHash: hash(6), substance: { contribution: "implement the feature", nonGoals: ["new persistence"], items: [{ itemId: "item-1", kind: "execution" as const, objective: "write code", dependsOn: [], scoutQuestion: "", workerAssignment: "worker", evidenceReferences: ["evidence-1"] }], requiredHandoffs: ["review"], budgetCeiling: "100 cents", expectedTime: "1h", maxRetries: 1, maxWorkers: 1, gitRepository: "repo", gitBranch: "branch", integrationPath: "main", risks: ["risk"], safePausePoints: ["after test"], escalationTriggers: ["failure"], evidenceReferences: ["evidence-1"], validationCriteria: ["tests"] } };
    const lines = renderDepartmentPlanPanel({ kind: "value", value: plan }, 240).join("\n");
    expect(lines).toContain("implement the feature");
    expect(lines).toContain("write code");
    expect(lines).toContain("Revision history unavailable from Department Plan route response.");
  });

  it("renders Worker fields and states mission and evidence payload gaps honestly", () => {
    const worker = { workerId: id(7), councilId: id(4), departmentId: "engineering", planVersion: 2, itemId: "item-1", bundleContentHash: hash(7), attempt: 1, executionRef: "exec-1", invocationRef: "invoke-1", status: "succeeded" as const, answerText: "done", usageTotalTokens: 42 };
    const lines = renderWorkerPanel({ kind: "value", value: worker }, 240).join("\n");
    expect(lines).toContain("exec-1");
    expect(lines).toContain("Mission unavailable from Worker route response.");
    expect(lines).toContain("Evidence references unavailable from Worker route response.");
  });

  it("renders Metronome reason, evidence, and repair details and marks findings absent", () => {
    const challenge = { challengeId: id(8), goalId: id(5), reason: "unsafe change", evidenceReferences: ["evidence-1"], status: "correction_requested" as const, correctionRequest: "add a test", raisedBy: "metronome", resolvedBy: null, resolutionReason: null, targetRef: "src/a.ts" };
    const lines = renderMetronomePanel({ kind: "value", value: [challenge] }, 240).join("\n");
    expect(lines).toContain("unsafe change");
    expect(lines).toContain("add a test");
    expect(lines).toContain("Findings unavailable from challenge-list route response.");
  });

  it("renders Encore judgment and synthesis substance", () => {
    const round = { roundId: id(9), goalId: id(5), question: "is it safe?", criteria: [{ criterionId: "c1", description: "tests" }], evidenceIds: ["evidence-1"], triggerReasons: ["risk"], reviewerCount: 1, judgments: [{ modelProvider: "provider", modelId: "model", verdict: "proceed" as const, confidence: "high" as const, reasoning: "yes", conditions: ["keep tests"], dissentNote: null, citedEvidenceIds: ["evidence-1"] }], synthesis: { finalVerdict: "proceed" as const, sameModelOnly: true, escalated: false, dissentNotes: [] } };
    const lines = renderEncorePanel({ kind: "value", value: [round] }, 240).join("\n");
    expect(lines).toContain("is it safe?");
    expect(lines).toContain("reasoning: yes");
    expect(lines).toContain("final verdict: proceed");
  });

  it("renders Certification identity and durable lineage while stating evidence findings are absent", () => {
    const certification = { certificationId: id(10), kind: "quality" as const, goalId: id(5), contractId: id(1), contractVersion: 3, contractContentHash: hash(1), integratedCommitSha: "a".repeat(40), workerId: id(7), departmentAcceptanceId: id(11), integrationRevisionId: id(12), verdict: "passed" as const, certifiedByDepartment: "engineering", producingDepartment: "engineering" };
    const lines = renderCertificationPanel({ kind: "value", value: [certification] }, 240).join("\n");
    expect(lines).toContain("passed");
    expect(lines).toContain("integration revision");
    expect(lines).toContain("Evidence and findings unavailable from certification-list route response.");
  });

  it("renders Budget reservation summary and states forecast and department breakdown are absent", () => {
    const budget = { goalId: id(5), projectId: id(2), budgetCents: 100, reservedCents: 25, costCents: 10 };
    const lines = renderBudgetPanel({ kind: "value", value: budget }, 240).join("\n");
    expect(lines).toContain("reserved: 25 cents");
    expect(lines).toContain("Forecast unavailable from GoalBudgetSummary route response.");
    expect(lines).toContain("Department breakdown unavailable from GoalBudgetSummary route response.");
  });

  it("preserves explicit empty and unavailable states", () => {
    expect(renderTaskContractPanel({ kind: "empty" }, 80)).toEqual(["Task Contract", "No Task Contract data."]);
    expect(renderBudgetPanel({ kind: "error", message: "offline" }, 80)).toEqual(["Budget", "Unable to read budget: offline"]);
  });
});
