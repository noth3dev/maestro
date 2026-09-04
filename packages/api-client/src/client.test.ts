import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./index.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const goalId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";

describe("createApiClient", () => {
  it("sends authenticated idempotent create commands and parses the result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ goalId, projectId, state: "draft", version: 0 }), { status: 201 }));
    const client = createApiClient({ baseUrl: "https://maestro.test/", token: "top-secret", fetch });

    await expect(client.createGoal({ projectId }, commandId)).resolves.toEqual({ goalId, projectId, state: "draft", version: 0 });
    expect(fetch).toHaveBeenCalledWith("https://maestro.test/v1/goals", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer top-secret", "content-type": "application/json", "idempotency-key": commandId },
      body: JSON.stringify({ projectId }),
    }));
  });

  it("preserves stable API errors without exposing the bearer token", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "version_conflict", message: "Version changed" } }), { status: 409 }));
    const client = createApiClient({ baseUrl: "https://maestro.test", token: "top-secret", fetch });

    await expect(client.transitionGoal(goalId, { projectId, expectedVersion: 0, to: "active" }, commandId)).rejects.toMatchObject<ApiError>({ name: "ApiError", status: 409, code: "version_conflict", message: "Version changed" });
    try { await client.transitionGoal(goalId, { projectId, expectedVersion: 0, to: "active" }, commandId); } catch (error) {
      expect(String(error)).not.toContain("top-secret");
    }
  });

  it("encodes goal queries and validates paged events", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [], nextCursor: "7" }), { status: 200 }));
    const client = createApiClient({ baseUrl: "https://maestro.test/api", token: "secret", fetch });

    await expect(client.listEvents({ projectId, after: "7" })).resolves.toEqual({ events: [], nextCursor: "7" });
    expect(fetch).toHaveBeenCalledWith(`https://maestro.test/api/v1/events?projectId=${projectId}&after=7`, expect.objectContaining({ headers: { authorization: "Bearer secret" } }));
  });
});

it("reads goal listing, budget, and derived state with typed methods", async () => {
 const bodies=[{goals:[{goalId,projectId,state:"draft",version:0}]},{goalId,projectId,budgetCents:10,reservedCents:4,costCents:3},{challenges:[]},{rounds:[]},{certifications:[]},{reportId:goalId,goalId,success:true,blockers:[],ceoRequest:"",whatChanged:"",userVisibleBehaviorPassed:true,participatingDepartments:[],keyDecisions:[],dissent:[],independentValidation:[],costCents:0,budgetCents:0,incidents:[],knownLimitations:[],criticalActionAwaitingApproval:false,evidenceBundleId:goalId}];
 const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(bodies.shift()),{status:200})); const c=createApiClient({baseUrl:"https://maestro.test",token:"t",fetch});
 await expect(c.listGoals(projectId)).resolves.toEqual({goals:[{goalId,projectId,state:"draft",version:0}]}); await expect(c.getBudgetSummary(goalId, { projectId })).resolves.toEqual({goalId,projectId,budgetCents:10,reservedCents:4,costCents:3}); await expect(c.listMetronomeChallenges(goalId, { projectId })).resolves.toEqual({challenges:[]}); await expect(c.listEncoreCouncilRounds(goalId, { projectId })).resolves.toEqual({rounds:[]}); await expect(c.listCertifications(goalId, { projectId })).resolves.toEqual({certifications:[]}); await expect(c.getConcertmasterReport(goalId, { projectId })).resolves.toMatchObject({success:true});
 expect(fetch).toHaveBeenNthCalledWith(1, `https://maestro.test/v1/goals?projectId=${projectId}`, expect.anything());
 expect(fetch).toHaveBeenNthCalledWith(2, `https://maestro.test/v1/goals/${goalId}/budget?projectId=${projectId}`, expect.anything());
});


it("runs the Task Contract lifecycle through typed authenticated requests", async () => {
  const contractId = "22222222-2222-4222-8222-222222222222";
  const substance = {
    desiredOutcome: "Ship", userVisibleBehavior: ["Works"], successCriteria: ["Passes"], liveEvidence: ["Live"],
    scope: ["Feature"], nonGoals: ["Other"], priorities: ["Safety"], acceptableTradeoffs: ["Time"], constraints: ["Local"], knownEdgeCases: ["Retry"],
    project: { projectId, repository: "/repo", immutableBaseRevision: "abc", dataBoundary: "repo" }, evidenceReferences: ["spec"], approvedPreviewReferences: [],
    expectedGroups: ["Product"], expectedDepartments: ["Product"], criticalActionExpectations: ["Approval"], forbiddenEffects: ["Deploy"],
    environmentAssumptions: ["DB"], externalServiceAssumptions: ["None"], budget: { ceiling: "10", reportingExpectations: ["Report"], stoppingConditions: ["Stop"] },
  };
  const contract = { contractId, schemaVersion: 1, version: 1, ...substance, decisionHistory: [], contentHash: "a".repeat(64), launchState: "awaiting_confirmation" };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(contract), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(contract), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...contract, version: 2 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ roles: ["conversation-lead"] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...contract, launchState: "launched" }), { status: 200 }));
  const client = createApiClient({ baseUrl: "https://maestro.test", token: "secret", fetch });
  await expect(client.createTaskContract({ projectId, substance }, contractId)).resolves.toEqual(contract);
  await expect(client.getTaskContract(contractId, { projectId })).resolves.toEqual(contract);
  await expect(client.updateTaskContract(contractId, { projectId, expectedVersion: 1, substance })).resolves.toMatchObject({ version: 2 });
  await expect(client.selectOvertureRoles(contractId, { projectId, outsideEvidenceRequested: true, previewNeeded: false })).resolves.toEqual({ roles: ["conversation-lead"] });
  await expect(client.confirmTaskContract(contractId, { projectId, version: 1, contentHash: contract.contentHash }, contractId)).resolves.toBeUndefined();
  await expect(client.launchTaskContract(contractId, projectId)).resolves.toMatchObject({ launchState: "launched" });
  expect(fetch).toHaveBeenNthCalledWith(1, `https://maestro.test/v1/task-contracts`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "idempotency-key": contractId }) }));
  expect(fetch).toHaveBeenNthCalledWith(2, `https://maestro.test/v1/task-contracts/${contractId}?projectId=${projectId}`, expect.anything());
  expect(fetch).toHaveBeenNthCalledWith(3, `https://maestro.test/v1/task-contracts/${contractId}`, expect.objectContaining({ method: "PUT" }));
});


it("approves and runs a critical action with the exact command identity", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    goalId, effect: "allow", reason: "exact_approval", classification: "critical", recordId: commandId,
  }), { status: 200 }));
  const client = createApiClient({ baseUrl: "https://maestro.test", token: "secret", fetch });
  const input = { projectId, action: "git.remote.push", target: "origin/main", policyVersion: 1, budgetEffectCents: 0, expiresAt: "2030-01-01T00:00:00.000Z" };
  await expect(client.approveAndRunCriticalAction(goalId, input, commandId)).resolves.toMatchObject({ effect: "allow", recordId: commandId });
  expect(fetch).toHaveBeenCalledWith(`https://maestro.test/v1/goals/${goalId}/critical-actions/approve-and-run`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "idempotency-key": commandId }), body: JSON.stringify(input) }));
});


it("activates a Goal-scoped Head through the typed client", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    goalId, departmentId: "product", headRoleId: "head:product", contractId: null, contextId: null,
    status: "active", activeSessionRef: "execution-1",
  }), { status: 200 }));
  const client = createApiClient({ baseUrl: "https://maestro.test", token: "secret", fetch });
  const input = { projectId, departmentId: "product", requestedContribution: "implement", urgency: "normal", contextScope: ["contract"], budgetEffect: "none", reason: "launch" };
  const commandId = "33333333-3333-4333-8333-333333333333";
  await expect(client.activateHead(goalId, input, commandId)).resolves.toMatchObject({ goalId, departmentId: "product", status: "active" });
  expect(fetch).toHaveBeenCalledWith(`https://maestro.test/v1/goals/${goalId}/head-participations`, expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "idempotency-key": commandId }), body: JSON.stringify(input) }));
});


it("drives the authenticated Head Council lifecycle", async () => {
  const councilId = "44444444-4444-4444-8444-444444444444";
  const contractId = "55555555-5555-4555-8555-555555555555";
  const council = { councilId, goalId, contractId, briefDeadline: "2030-01-01T00:00:00.000Z", state: "resolved", noNewEvidenceStreak: 0, decisionPacket: null, snapshotHash: "a".repeat(64), snapshot: {} };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(council), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(council), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(council), { status: 200 }));
  const client = createApiClient({ baseUrl: "https://maestro.test", token: "secret", fetch });
  const createInput = { projectId, contractId, briefDeadline: council.briefDeadline, evidence: {} };
  const brief = { interpretation: "safe", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };
  const packet = { outcome: "decided", executionDisposition: "executable", selectedDirection: "ship", rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "implement" }], workerPlan: [], completionCriteria: ["pass"], failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
  await expect(client.createCouncil(goalId, createInput, commandId)).resolves.toEqual(council);
  await expect(client.getCouncil(councilId, projectId)).resolves.toEqual(council);
  await expect(client.submitCouncilBrief(councilId, "product", { projectId, brief }, commandId)).resolves.toBeUndefined();
  await expect(client.revealCouncil(councilId, projectId, commandId)).resolves.toBeUndefined();
  await expect(client.decideCouncil(councilId, { projectId, packet }, commandId)).resolves.toEqual(council);
});
