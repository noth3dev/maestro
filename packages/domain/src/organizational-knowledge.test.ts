import { describe, expect, it } from "vitest";
import {
  createWorkerProposedKnowledge,
  decayOrganizationalKnowledge,
  promoteKnowledgeToGlobal,
  promoteKnowledgeToProject,
  retireOrganizationalKnowledge,
  type OrganizationalKnowledgeProposal,
} from "./organizational-knowledge.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const evidenceId2 = "44444444-4444-4444-8444-444444444444";
const digestId = "55555555-5555-4555-8555-555555555555";
const digestId2 = "66666666-6666-4666-8666-666666666666";
const base = (overrides: Partial<OrganizationalKnowledgeProposal> = {}): OrganizationalKnowledgeProposal => ({
  schemaVersion: 1, projectId, sourceGoalId: goalId, departmentId: "engineering",
  statement: "Keep the validation gate before applying a bounded change.",
  rationale: "The gate prevented a repeat failure.", sourceEvidenceIds: [evidenceId, evidenceId2], sourceDigestIds: [digestId, digestId2],
  episodeIds: ["episode-a", "episode-b"], confidence: 0.9, freshness: 1, generalized: false, ...overrides,
});

describe("organizational knowledge promotion gates", () => {
  it("stores a worker proposal as non-durable until a Department Head promotes it", () => {
    const proposal = createWorkerProposedKnowledge(base());
    expect(proposal.scope).toBe("worker_proposed");
    expect(proposal.status).toBe("proposed");
    expect(() => promoteKnowledgeToProject(proposal, { promoterRoleKind: "worker", promoterDepartmentId: "engineering" })).toThrow(/Department Head/);
    expect(() => promoteKnowledgeToGlobal(proposal, { encoreCouncilApproved: true, corroboratingSourceIds: [digestId, digestId2], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).toThrow(/Department Head project/);
    expect(() => promoteKnowledgeToProject(proposal, { promoterRoleKind: "department_head", promoterDepartmentId: "security" })).toThrow(/department/);
    expect(promoteKnowledgeToProject(proposal, { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" })).toMatchObject({ scope: "project_department", status: "active", projectId });
  });

  it("keeps Department Head promotion scoped to its source project and Department", () => {
    const promoted = promoteKnowledgeToProject(createWorkerProposedKnowledge(base()), { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" });
    expect(promoted.projectId).toBe(projectId);
    expect(promoted.departmentId).toBe("engineering");
    expect(promoted.scope).not.toBe("global");
  });

  it("requires generalized safe content and Encore Council approval for global reuse", () => {
    const proposal = promoteKnowledgeToProject(createWorkerProposedKnowledge(base({ generalized: true, statement: "Use bounded validation gates for changes." })), { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" });
    expect(() => promoteKnowledgeToGlobal(proposal, { encoreCouncilApproved: false, corroboratingSourceIds: [digestId, digestId2], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).toThrow(/Council/);
    expect(() => promoteKnowledgeToGlobal(promoteKnowledgeToProject(createWorkerProposedKnowledge(base({ generalized: false })), { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" }), { encoreCouncilApproved: true, corroboratingSourceIds: [digestId, digestId2], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: projectId, curatorRoleId: "head-security" })).toThrow(/generalized|raw|safe/);
    expect(promoteKnowledgeToGlobal(proposal, { encoreCouncilApproved: true, corroboratingSourceIds: [digestId, digestId2], corroboratingEpisodeIds: ["episode-a", "episode-b"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).toMatchObject({ scope: "global", status: "active", projectId: null });
  });

  it("rejects a single corroborating episode for global promotion", () => {
    const proposal = promoteKnowledgeToProject(createWorkerProposedKnowledge(base({ generalized: true, statement: "Use bounded validation gates." })), { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" });
    expect(() => promoteKnowledgeToGlobal(proposal, { encoreCouncilApproved: true, corroboratingSourceIds: [digestId], corroboratingEpisodeIds: ["episode-a"], generalizedStatement: "Use bounded validation gates.", curatorRoleId: "head-security" })).toThrow(/episode|corroborat/i);
  });

  it("decays stale and contradicted knowledge without hiding contradiction state", () => {
    const stale = promoteKnowledgeToProject(createWorkerProposedKnowledge(base()), { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" });
    const decayed = decayOrganizationalKnowledge(stale, { now: "2026-09-20T00:00:00.000Z", lastSupportedAt: "2026-08-01T00:00:00.000Z", staleAfterMs: 86_400_000 });
    expect(decayed.confidence).toBeLessThan(stale.confidence);
    expect(decayed.freshness).toBeLessThan(stale.freshness);
    const contradicted = decayOrganizationalKnowledge(stale, { now: "2026-09-20T00:00:00.000Z", lastSupportedAt: stale.createdAt, contradicted: true });
    expect(contradicted.status).toBe("contradicted");
    expect(contradicted.confidence).toBeLessThan(stale.confidence);
  });

  it("retires by appending provenance instead of deleting the lesson", () => {
    const promoted = promoteKnowledgeToProject(createWorkerProposedKnowledge(base()), { promoterRoleKind: "department_head", promoterDepartmentId: "engineering" });
    const retired = retireOrganizationalKnowledge(promoted, { status: "retired", reason: "Superseded by the reviewed runbook." });
    expect(retired.status).toBe("retired");
    expect(retired.reason).toContain("Superseded");
    expect(retired.knowledgeId).toBe(promoted.knowledgeId);
    expect(retired.revision).toBe(promoted.revision + 1);
  });
});
