import { describe, expect, it } from "vitest";
import { amendTaskContract, assertValidTaskContractSubstance, createTaskContract, selectOvertureRoles, taskContractContentHash, type TaskContractSubstance } from "./task-contract.js";

const substance: TaskContractSubstance = {
  desiredOutcome: "A durable contract", userVisibleBehavior: ["CEO can confirm exact content"],
  successCriteria: ["launch needs confirmation"], liveEvidence: ["integration test"], scope: ["contract slice"], nonGoals: ["workers"],
  priorities: ["safety"], acceptableTradeoffs: ["no UI"], constraints: ["PostgreSQL"], knownEdgeCases: ["edit during confirmation"],
  project: { projectId: "project", repository: "repo", immutableBaseRevision: "abc123", dataBoundary: "local repository only" },
  evidenceReferences: ["plan/phase2.md"], approvedPreviewReferences: [], expectedGroups: ["Product Group"], expectedDepartments: ["Product Department"],
  criticalActionExpectations: ["explicit launch"], forbiddenEffects: ["spawn workers"], environmentAssumptions: ["local PostgreSQL"], externalServiceAssumptions: ["none"],
  budget: { ceiling: "100 USD", reportingExpectations: ["on launch"], stoppingConditions: ["ceiling reached"] },
};

describe("Task Contract", () => {
  it("hashes canonical substance independent of object-key order", () => {
    expect(taskContractContentHash(substance)).toBe(taskContractContentHash({ ...substance, project: { dataBoundary: "local repository only", immutableBaseRevision: "abc123", repository: "repo", projectId: "project" } }));
  });
  it("increments version and invalidates launch state after a substantive edit", () => {
    const original = createTaskContract("contract", substance);
    const amended = amendTaskContract(original, { ...substance, desiredOutcome: "An amended contract" }, { decisionId: "amendment", kind: "amended", evidence: { reason: "CEO edit" } });
    expect(amended).toMatchObject({ version: 2, launchState: "awaiting_confirmation" });
    expect(amended.contentHash).not.toBe(original.contentHash);
  });
  it("rejects missing required fields at the runtime boundary", () => {
    expect(() => assertValidTaskContractSubstance({ ...substance, project: { ...substance.project, immutableBaseRevision: "" } })).toThrow("project boundary");
    expect(() => assertValidTaskContractSubstance({ ...substance, budget: { ...substance.budget, stoppingConditions: [1] } })).toThrow("budget");
  });
  it("selects only the necessary named Overture roles", () => {
    expect(selectOvertureRoles({ outsideEvidenceRequested: false, previewNeeded: false })).toEqual(["project-context-scout", "requirements-analyst", "task-editor"]);
    expect(selectOvertureRoles({ outsideEvidenceRequested: true, previewNeeded: true })).toEqual(["project-context-scout", "external-research-scout", "requirements-analyst", "design-mock-specialist", "task-editor"]);
  });
});
