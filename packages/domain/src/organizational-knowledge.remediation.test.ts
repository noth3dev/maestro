import { describe, expect, it } from "vitest";
import { createWorkerProposedKnowledge, promoteKnowledgeToGlobal, promoteKnowledgeToProject } from "./organizational-knowledge.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const evidenceA = "33333333-3333-4333-8333-333333333333";
const evidenceB = "44444444-4444-4444-8444-444444444444";
const digestA = "55555555-5555-4555-8555-555555555555";
const digestB = "66666666-6666-4666-8666-666666666666";
const proposal = createWorkerProposedKnowledge({ schemaVersion: 1, projectId, sourceGoalId: goalId, departmentId: "engineering", statement: "Keep validation bounded.", rationale: "It prevents recurrence.", sourceEvidenceIds: [evidenceA, evidenceB], sourceDigestIds: [digestA, digestB], episodeIds: ["episode-a", "episode-b"], confidence: 0.8, freshness: 1, generalized: true });
const project = promoteKnowledgeToProject(proposal, { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" });
const approved = { encoreCouncilApproved: true, corroboratingSourceIds: [digestA, digestB], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates for changes.", curatorRoleId: "head-security" };

describe("organizational knowledge remediation gates", () => {
  it("requires an independently curated generalized representation and explicit safety proof", () => {
    expect(() => promoteKnowledgeToGlobal(project, { encoreCouncilApproved: true, corroboratingSourceIds: [evidenceA, evidenceB] } as never)).toThrow(/curat|generalized|source/i);
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, generalizedStatement: "Project-specific raw detail" })).toThrow(/raw|safe/i);
    expect(promoteKnowledgeToGlobal(project, approved)).toMatchObject({ scope: "global", projectId: null, generalized: true, statement: approved.generalizedStatement });
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, corroboratingEpisodeIds: ["episode-b", "episode-a"] })).toThrow(/episode|bound|corroborat/i);
  });

  it("requires distinct source-bound corroborating evidence, not arbitrary episode labels", () => {
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, corroboratingEpisodeIds: ["episode-a"] })).toThrow(/episode|corroborat/i);
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, corroboratingSourceIds: [digestA] })).toThrow(/source|corroborat/i);
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, corroboratingSourceIds: [digestA, digestA] })).toThrow(/source|distinct|corroborat/i);
    expect(() => promoteKnowledgeToGlobal(project, { ...approved, corroboratingSourceIds: [digestA, goalId] })).toThrow(/source|reference/i);
  });
});
