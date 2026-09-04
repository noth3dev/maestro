import { describe, expect, it, vi } from "vitest";
import { buildServer, type OperatorAuthenticator, type TaskContractService } from "./server.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const contractId = "22222222-2222-4222-8222-222222222222";
const operator = { operatorId: "33333333-3333-4333-8333-333333333333", credentialId: "44444444-4444-4444-8444-444444444444" };
const substance = {
  desiredOutcome: "Ship the feature", userVisibleBehavior: ["Users can use it"], successCriteria: ["The check passes"],
  liveEvidence: ["A live request"], scope: ["The feature"], nonGoals: ["Unrelated work"], priorities: ["Safety"],
  acceptableTradeoffs: ["Slower launch"], constraints: ["Local only"], knownEdgeCases: ["Retry"],
  project: { projectId, repository: "/repo", immutableBaseRevision: "abc123", dataBoundary: "repo only" },
  evidenceReferences: ["docs/spec.md"], approvedPreviewReferences: [], expectedGroups: ["Product Group"],
  expectedDepartments: ["Product Department"], criticalActionExpectations: ["Approval required"], forbiddenEffects: ["Deploy"],
  environmentAssumptions: ["PostgreSQL"], externalServiceAssumptions: ["None"],
  budget: { ceiling: "100 USD", reportingExpectations: ["Report spend"], stoppingConditions: ["At ceiling"] },
};
const contract = {
  contractId, schemaVersion: 1, version: 1, ...substance,
  decisionHistory: [{ decisionId: "55555555-5555-4555-8555-555555555555", kind: "created", evidence: {} }],
  contentHash: "a".repeat(64), launchState: "awaiting_confirmation",
} as const;

const authenticated: OperatorAuthenticator = { authenticateBearerSecret: async () => ({ outcome: "authenticated", operator }) };
function service(overrides: Partial<TaskContractService> = {}): TaskContractService {
  return {
    createTaskContract: vi.fn(async () => contract),
    getTaskContract: vi.fn(async () => contract),
    updateTaskContract: vi.fn(async () => ({ ...contract, version: 2, desiredOutcome: "Updated" })),
    selectOvertureRoles: vi.fn(async () => ["conversation-lead", "security-evaluator", "task-editor"]),
    confirmTaskContract: vi.fn(async () => undefined),
    launchTaskContract: vi.fn(async () => ({ ...contract, launchState: "launched" })),
    ...overrides,
  };
}

const authHeaders = { authorization: "Bearer test-secret" };

describe("Task Contract API routes", () => {
  it("exposes the authenticated Task Contract lifecycle and passes the operator to actor-bound writes", async () => {
    const taskContracts = service();
    const app = buildServer({ goalService: {
      createGoal: async () => ({ goalId: contractId, projectId, state: "draft", version: 0 }),
      transitionGoal: async () => ({ goalId: contractId, projectId, state: "active", version: 1 }),
      getGoal: async () => ({ goalId: contractId, projectId, state: "draft", version: 0 }),
    }, authenticator: authenticated, taskContractService: taskContracts });

    const created = await app.inject({ method: "POST", url: "/v1/task-contracts", headers: { ...authHeaders, "idempotency-key": contractId }, payload: { projectId, substance } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(contract);
    expect(taskContracts.createTaskContract).toHaveBeenCalledWith(contractId, { projectId, substance }, operator);

    const read = await app.inject({ method: "GET", url: `/v1/task-contracts/${contractId}?projectId=${projectId}`, headers: authHeaders });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(contract);

    const updated = await app.inject({ method: "PUT", url: `/v1/task-contracts/${contractId}`, headers: authHeaders, payload: { projectId, expectedVersion: 1, substance, evidence: { reason: "CEO edit" } } });
    expect(updated.statusCode).toBe(200);
    expect(taskContracts.updateTaskContract).toHaveBeenCalledWith(contractId, { projectId, expectedVersion: 1, substance, evidence: { reason: "CEO edit" } }, operator, contractId);

    const selected = await app.inject({ method: "POST", url: `/v1/task-contracts/${contractId}/overture-selection`, headers: authHeaders, payload: { projectId, outsideEvidenceRequested: true, previewNeeded: false } });
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toEqual({ roles: ["conversation-lead", "security-evaluator", "task-editor"] });
    expect(taskContracts.selectOvertureRoles).toHaveBeenCalledWith(contractId, { projectId, outsideEvidenceRequested: true, previewNeeded: false }, contractId, operator);

    const confirmed = await app.inject({ method: "POST", url: `/v1/task-contracts/${contractId}/confirmation`, headers: authHeaders, payload: { projectId, version: 1, contentHash: contract.contentHash } });
    expect(confirmed.statusCode).toBe(204);
    expect(taskContracts.confirmTaskContract).toHaveBeenCalledWith(contractId, { projectId, version: 1, contentHash: contract.contentHash }, operator, contractId);

    const launched = await app.inject({ method: "POST", url: `/v1/task-contracts/${contractId}/launch`, headers: authHeaders, payload: { projectId } });
    expect(launched.statusCode).toBe(200);
    expect(launched.json()).toMatchObject({ launchState: "launched" });

    await app.close();
  });

  it("checks project membership before every Task Contract route", async () => {
    const taskContracts = service();
    const membership = { assertProjectMembership: vi.fn(async () => { throw new Error("membership denied"); }) };
    const app = buildServer({ goalService: {
      createGoal: async () => ({ goalId: contractId, projectId, state: "draft", version: 0 }),
      transitionGoal: async () => ({ goalId: contractId, projectId, state: "active", version: 1 }),
      getGoal: async () => ({ goalId: contractId, projectId, state: "draft", version: 0 }),
    }, authenticator: authenticated, taskContractService: taskContracts, projectMembership: membership });
    const requests = [
      { method: "POST", url: "/v1/task-contracts", payload: { projectId, substance }, headers: { ...authHeaders, "idempotency-key": contractId } },
      { method: "GET", url: `/v1/task-contracts/${contractId}?projectId=${projectId}`, headers: authHeaders },
      { method: "PUT", url: `/v1/task-contracts/${contractId}`, payload: { projectId, expectedVersion: 1, substance }, headers: authHeaders },
      { method: "POST", url: `/v1/task-contracts/${contractId}/overture-selection`, payload: { projectId, outsideEvidenceRequested: false, previewNeeded: false }, headers: authHeaders },
      { method: "POST", url: `/v1/task-contracts/${contractId}/confirmation`, payload: { projectId, version: 1, contentHash: contract.contentHash }, headers: authHeaders },
      { method: "POST", url: `/v1/task-contracts/${contractId}/launch`, payload: { projectId }, headers: authHeaders },
    ] as const;
    for (const request of requests) expect((await app.inject(request)).statusCode).toBe(503);
    expect(membership.assertProjectMembership).toHaveBeenCalledTimes(requests.length);
    expect(taskContracts.createTaskContract).not.toHaveBeenCalled();
    expect(taskContracts.getTaskContract).not.toHaveBeenCalled();
    await app.close();
  });
});
