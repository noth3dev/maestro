import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

const parsed = parseArgs({ options: { kind: { type: "string" }, project: { type: "string" }, repository: { type: "string" }, base: { type: "string" }, out: { type: "string" }, contract: { type: "string" }, target: { type: "string" }, item: { type: "string" }, verdict: { type: "string" } } });
const { kind, project: projectId, out } = parsed.values;
if (!kind || !projectId || !out) throw new Error("--kind, --project, and --out are required");
const list = (value) => [value];
const requirement = { level: 80, rationale: "Head requirement" };
const taskDemand = { schemaVersion: 1, taskKinds: ["coding"], requirements: { reasoning: requirement, coding: requirement, verification: requirement, "instruction-fidelity": requirement, "tool-use": requirement, "long-context": requirement, knowledge: requirement, "refusal-calibration": requirement }, provenance: { taskContractRef: parsed.values.contract ?? "contract:release-scenario", headDecisionRef: "head-decision:release-scenario" } };
let value;
if (kind === "contract") {
  if (!parsed.values.repository || !parsed.values.base) throw new Error("contract requires --repository and --base");
  value = { desiredOutcome: "Apply the requested discount in the disposable target.", userVisibleBehavior: ["The target applies the requested discount."], successCriteria: ["The target test passes after repair."], liveEvidence: ["Target test output", "integrated local Git revision"], scope: ["The disposable target under MAESTRO_WORKTREE_ROOT"], nonGoals: ["No remote push", "No production repository changes"], priorities: ["Correctness", "Reproducibility"], acceptableTradeoffs: ["A local fake provider may stand in for live acceptance in CI"], constraints: ["Keep all effects inside the disposable target"], knownEdgeCases: ["Unsupported assertions", "Control Plane restart"], project: { projectId, repository: parsed.values.repository, immutableBaseRevision: parsed.values.base, dataBoundary: "local disposable project only" }, evidenceReferences: ["release-scenario-runbook"], approvedPreviewReferences: [], expectedGroups: ["engineering"], expectedDepartments: ["engineering"], criticalActionExpectations: ["Remote push requires explicit user approval"], forbiddenEffects: ["Remote push", "Writes outside the disposable target"], environmentAssumptions: ["Node.js and Git are installed"], externalServiceAssumptions: ["No external service is needed by the fixture"], budget: { ceiling: "local test budget", reportingExpectations: ["Report target test and Git revision"], stoppingConditions: ["Any forbidden effect"] } };
} else if (kind === "head") {
  value = { projectId, departmentId: "engineering", headRoleId: "head:engineering", requestedContribution: "Plan the smallest safe repair.", urgency: "normal", contextScope: ["discount repair", "disposable target"], budgetEffect: "none", reason: "Necessary execution planning only", evidence: { source: "release-scenario-runbook" } };
} else if (kind === "council") {
  value = { projectId, contractId: parsed.values.contract, briefDeadline: new Date(Date.now() + 3600000).toISOString(), evidence: { source: "release-scenario-runbook" } };
} else if (kind === "brief") {
  value = { projectId, brief: { interpretation: "Repair the discount function.", contribution: "Bounded engineering repair.", nonGoals: list("No remote push"), assumptions: list("The target is disposable"), evidenceGaps: list("Live provider evidence is user-owned"), risks: list("Seeded defect"), dependencies: list("Target test"), proposedValidation: list("npm test --prefix TARGET"), expectedWorkers: list("one repair worker"), expectedCost: "local", expectedTime: "short", objectionsToLikelyAlternatives: list("Do not edit the repository root") } };
} else if (kind === "packet") {
  value = { projectId, packet: { outcome: "decided", executionDisposition: "executable", selectedDirection: "Repair only the disposable target.", rejectedAlternatives: [], departmentOwnership: [{ departmentId: "engineering", responsibility: "repair and test" }], workerPlan: [{ departmentId: "engineering", plan: "run the bounded repair" }], completionCriteria: list("target test passes"), failureCriteria: list("target test fails"), dissent: list("none"), uncertainty: list("live provider remains user-owned"), criticalActions: list("remote push requires approval"), unresolvedConflicts: list("none"), evidenceReferences: list("release-scenario-runbook") } };
} else if (kind === "plan") {
  value = { projectId, substance: { contribution: "Repair the disposable discount target.", nonGoals: ["No remote push"], items: [{ itemId: parsed.values.item ?? "discount-repair", kind: "execution", objective: "Apply the discount rate", dependsOn: [], scoutQuestion: "", workerAssignment: "repair worker", evidenceReferences: ["release-scenario-runbook"] }], requiredHandoffs: ["Quality certification"], budgetCeiling: "local", expectedTime: "short", maxRetries: 0, maxWorkers: 1, gitRepository: parsed.values.target ?? "TARGET", gitBranch: "release-scenario", integrationPath: "local target", risks: ["seeded defect"], safePausePoints: ["before repair"], escalationTriggers: ["remote push"], evidenceReferences: ["release-scenario-runbook"], validationCriteria: ["target test passes"] } };
} else if (kind === "mission") {
  value = { projectId, substance: { role: "execution", profileRef: "release-scenario", goalBrief: "Inspect the seeded discount defect and report; do not repair before Quality review.", taskDemand, approvedModels: [process.env.MAESTRO_NATIVE_MODEL ?? "test/model-a"], allowedSkills: ["implementation"], allowedTools: ["ipython", "read", "write"], allowedPaths: ["."], environment: ["node"], authorityBoundary: ["read-write"], externalServiceBoundary: ["none"], dataBoundary: "target only", costCeiling: "local", timeCeiling: "short", retryCeiling: 0, workerCeiling: 1, deliverable: "seeded-defect test evidence", evidenceRequirements: ["test output"], validationCriteria: ["npm test"], terminationConditions: ["pass or fail"] } };
} else if (kind === "worker") {
  value = { projectId, planVersion: 1, itemId: parsed.values.item ?? "discount-repair", model: process.env.MAESTRO_NATIVE_MODEL ?? "test/model-a" };
} else if (kind === "review") {
  value = { projectId, question: "Was the unsupported assertion handled safely?", criteria: [{ criterionId: "unsupported", description: "Challenge unsupported assertions" }], evidenceIds: ["release-scenario-runbook"], reviewerCount: 2 };
} else if (kind === "certification") {
  value = { projectId, certifyingDepartmentId: "engineering", substance: { verdict: parsed.values.verdict ?? "failed", findings: [{ findingId: "release-scenario", severity: parsed.values.verdict === "passed" ? "noncritical" : "critical", description: parsed.values.verdict === "passed" ? "Target test passes" : "Seeded defect remains" }], testEvidenceIds: ["target-test"] } };
} else {
  throw new Error(`unsupported input kind: ${kind}`);
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(value, null, 2) + "\n");
console.log(out);
