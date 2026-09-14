import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GoalEvent, GoalBudgetSummary, Certification, EvidenceBundleRead } from "@maestro/api-client";
import type { ProjectionReadModel } from "@maestro/contracts";
import { GoalDepartmentPanels } from "./GoalDepartmentPanels.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const projection: ProjectionReadModel = {
  eventCursor: "8",
  nodes: [
    { nodeId: goalId, kind: "goal", projectId, goalId, parentNodeId: null, sectorId: "main", state: "active", version: 4, ownerId: null, crossLinks: [], sourceRevision: "4", eventCursor: "8", removed: false, sourceKey: [goalId] },
    { nodeId: "council-1", kind: "council", projectId, goalId, parentNodeId: goalId, sectorId: "main", state: "decided", version: null, ownerId: null, crossLinks: [], sourceRevision: "2", eventCursor: "5", removed: false, sourceKey: ["council-1"] },
    { nodeId: "department-plan:1:engineering", kind: "department_plan", projectId, goalId, parentNodeId: "council-1", sectorId: "engineering", state: "active", version: 2, ownerId: "engineering-head", crossLinks: [], sourceRevision: "2", eventCursor: "6", removed: false, sourceKey: ["council-1", "engineering"] },
    { nodeId: "department-plan:1:research", kind: "department_plan", projectId, goalId, parentNodeId: "council-1", sectorId: "research", state: "sleeping", version: 1, ownerId: "research-head", crossLinks: [], sourceRevision: "1", eventCursor: "6", removed: false, sourceKey: ["council-1", "research"] },
    { nodeId: workerId, kind: "worker", projectId, goalId, parentNodeId: "bundle-1", sectorId: "engineering", state: "running", version: null, ownerId: "worker-owner", crossLinks: [], sourceRevision: "2026-01-01T00:00:00.000Z", eventCursor: "8", removed: false, sourceKey: [workerId] },
    { nodeId: "approval-1", kind: "capability_approval", projectId, goalId, parentNodeId: goalId, sectorId: "git", state: "approved", version: null, ownerId: "operator-1", crossLinks: [], sourceRevision: "2026-01-01T00:00:00.000Z", eventCursor: "7", removed: false, sourceKey: ["approval-1"] },
  ],
  edges: [],
};
const events: GoalEvent[] = [{ eventId: "44444444-4444-4444-8444-444444444444", cursor: "8", projectId, goalId, aggregateVersion: "4", eventType: "goal.updated", schemaVersion: 1, payload: {}, occurredAt: "2026-01-01T00:00:00.000Z" }];
const budget: GoalBudgetSummary = { goalId, projectId, budgetCents: 10000, reservedCents: 2500, costCents: 700 };
const certification: Certification = { certificationId: "55555555-5555-4555-8555-555555555555", kind: "quality", goalId, contractId: "66666666-6666-4666-8666-666666666666", contractVersion: 1, contractContentHash: "hash", integratedCommitSha: "a".repeat(40), workerId, departmentAcceptanceId: "77777777-7777-4777-8777-777777777777", integrationRevisionId: "88888888-8888-4888-8888-888888888888", verdict: "passed", certifiedByDepartment: "quality", producingDepartment: "engineering" };
const evidence: EvidenceBundleRead = { bundleId: "99999999-9999-4999-8999-999999999999", goalId, content: { summary: "durable" }, hash: "b".repeat(64) };

describe("Goal and Department panels", () => {
  it("renders every panel from the shared projection identities and durable values", () => {
    const html = renderToStaticMarkup(<GoalDepartmentPanels projection={projection} events={events} budget={budget} certifications={[certification]} evidenceBundle={evidence} />);
    expect(html).toContain("Goal timeline");
    expect(html).toContain('data-node-id="department-plan:1:engineering"');
    expect(html).toContain('data-node-version="2"');
    expect(html).toContain("$25.00 reserved");
    expect(html).toContain("approval-1");
    expect(html).toContain(evidence.bundleId);
    expect(html).toContain(certification.certificationId);
  });

  it("shows sleeping Departments as identity and state only", () => {
    const html = renderToStaticMarkup(<GoalDepartmentPanels projection={projection} events={events} budget={budget} certifications={[]} />);
    expect(html).toContain("research");
    expect(html).toContain("sleeping");
    expect(html).not.toContain("research-head");
    expect(html).not.toContain("department-plan:1:research:execution");
  });
});
