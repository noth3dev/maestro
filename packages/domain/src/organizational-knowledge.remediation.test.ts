import { describe, expect, it } from "vitest";
import { createWorkerProposedKnowledge, promoteKnowledgeToGlobal, promoteKnowledgeToProject } from "./organizational-knowledge.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const evidenceA = "33333333-3333-4333-8333-333333333333";
const evidenceB = "44444444-4444-4444-8444-444444444444";
const proposal = createWorkerProposedKnowledge({ schemaVersion: 1, projectId, sourceGoalId: goalId, departmentId: "engineering", statement: "Keep validation bounded.", rationale: "It prevents recurrence.", sourceEvidenceIds: [evidenceA, evidenceB], sourceDigestIds: [], episodeIds: ["episode-a"], confidence: 0.8, freshness: 1, generalized: false });
const project = promoteKnowledgeToProject(proposal, { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" });
const approved = { encoreCouncilApproved: true, corroboratingSourceIds: [evidenceA, evidenceB], generalizedStatement: "Use bounded validation gates for changes.", curatorRoleId: "head-security", noRawProjectContent: true, noPersonalInformation: true };

describe("organizational knowledge remediation gates", () => {
  it("requires an independently curated generalized representation and explicit safety proof", () => {
    expect(() => promoteKnowledgeToGlobal(project, { encoreCouncilApproved: true, corroboratingSourceIds: [evidenceA, evidenceB] } as never)).toThrow(/curat|generalized/i);
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, noRawProjectContent: false })).toThrow(/raw|safe/i);
    expect(promoteKnowledgeToGlobal(project, approved)).toMatchObject({ scope: "global", projectId: null, generalized: true, statement: approved.generalizedStatement });
  });

  it("requires distinct source-bound corroborating evidence, not arbitrary episode labels", () => {
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, corroboratingSourceIds: [evidenceA] })).toThrow(/source|corroborat/i);
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, corroboratingSourceIds: [evidenceA, evidenceA] })).toThrow(/source|distinct|corroborat/i);
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, corroboratingSourceIds: [evidenceA, goalId] })).toThrow(/source|reference/i);
  });
});
