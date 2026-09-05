import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionKernelPort, GitPort } from "@maestro/domain";
import { applyAllMigrations, bootstrapLocalOperator, bootstrapPermanentOrganization, createDurableTaskContract, grantProjectMembership, grantProjectRole, launchConfirmedTaskContract, recordExactTaskContractConfirmation } from "@maestro/persistence";
import { createControlPlane } from "./main.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function gitPort(): { git: GitPort; createBranch: ReturnType<typeof vi.fn>; } {
  const createBranch = vi.fn(async () => {});
  return { git: {
    createBranch, createWorktree: async () => {}, advanceBranch: async () => {}, commit: async () => ({ commitSha: "a".repeat(40) }),
    headRevision: async () => "c".repeat(40), removeWorktree: async () => {},
  }, createBranch };
}

function kernel(): { kernel: ExecutionKernelPort; spawn: ReturnType<typeof vi.fn> } {
  let count = 0;
  const spawn = vi.fn(async () => { count += 1; return { execution: `execution-head-${count}` as never, invocation: `invocation-head-${count}` as never }; });
  return { kernel: {
    spawn,
    prompt: async () => {},
    observe: async () => [],
    sendMessage: async () => {},
    cancel: async () => ({ cancelled: false }),
    getModelIdentity: async () => ({ provider: "test", id: "test" }),
    getToolEvents: async () => ({ state: "empty", events: [] }),
    getUsage: async () => ({ state: "unknown" }),
    getInvocationStatus: async () => "unknown",
    resume: async () => { throw new Error("not supported"); },
    reconnect: async () => { throw new Error("not supported"); },
    release: async () => {},
  }, spawn };
}

describeDatabase("authenticated Head activation API", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `head_api_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl === undefined ? "" : (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE reconciler_leader_lease, goal_head_participations, task_contracts, goal_controls, goal_leases, outbox, goal_events, command_receipts, goals, operator_project_memberships, local_operator_credentials, local_operators CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  it("activates a real Goal-scoped Head through HTTP and retries without a second provider session", async () => {
    const secret = `head-api-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    const goalId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    const { kernel: executionKernel, spawn } = kernel();
    const controlPlane = createControlPlane({ databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `head-api-${randomUUID()}` }, { executionKernel });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    try {
      const create = await fetch(`${baseUrl}/v1/goals`, { method: "POST", headers: { ...auth, "idempotency-key": goalId }, body: JSON.stringify({ projectId }) });
      expect(create.status).toBe(201);
      for (const [expectedVersion, to] of [[1, "ready_for_confirmation"], [2, "launched"], [3, "active"]] as const) {
        const transitioned = await fetch(`${baseUrl}/v1/goals/${goalId}/transitions`, { method: "POST", headers: { ...auth, "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId, expectedVersion, to }) });
        expect(transitioned.status).toBe(200);
      }
      const activation = { projectId, departmentId: "product", requestedContribution: "own implementation", urgency: "normal", contextScope: ["confirmed contract"], budgetEffect: "within envelope", reason: "activate Product Head" };
      const activationCommandId = randomUUID();
      const first = await fetch(`${baseUrl}/v1/goals/${goalId}/head-participations`, { method: "POST", headers: { ...auth, "idempotency-key": activationCommandId }, body: JSON.stringify(activation) });
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ goalId, departmentId: "product", headRoleId: "head:product", status: "active", activeSessionRef: "execution-head-1" });
      const second = await fetch(`${baseUrl}/v1/goals/${goalId}/head-participations`, { method: "POST", headers: { ...auth, "idempotency-key": activationCommandId }, body: JSON.stringify(activation) });
      expect(second.status).toBe(200);
      expect(spawn).toHaveBeenCalledTimes(1);
      const stored = await pool.query("SELECT status, active_session_ref FROM goal_head_participations WHERE goal_id = $1 AND department_id = 'product'", [goalId]);
      expect(stored.rows).toEqual([{ status: "active", active_session_ref: "execution-head-1" }]);
    } finally { await controlPlane.close(); }
  });

  it("drives Task Contract-linked Heads and a resolved Council through authenticated HTTP", async () => {
    const secret = `council-api-${randomUUID()}`;
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    const projectId = randomUUID();
    const goalId = randomUUID();
    const contractId = randomUUID();
    await grantProjectMembership(pool, operatorId, projectId);
    await grantProjectRole(pool, operatorId, projectId, "concertmaster");
    await grantProjectRole(pool, operatorId, projectId, "head-product");
    await grantProjectRole(pool, operatorId, projectId, "head-quality");
    const repository = "/tmp/maestro-api-repository";
    const substance = {
      desiredOutcome: "ship a bounded change", userVisibleBehavior: ["the change is visible"], successCriteria: ["tests pass"], liveEvidence: ["test run"],
      scope: ["one change"], nonGoals: ["unrelated work"], priorities: ["safety"], acceptableTradeoffs: ["no UI"], constraints: ["local"], knownEdgeCases: ["retry"],
      project: { projectId, repository, immutableBaseRevision: "b".repeat(40), dataBoundary: "repository only" }, evidenceReferences: [], approvedPreviewReferences: [],
      expectedGroups: ["Product Group"], expectedDepartments: ["Product Department", "Quality Department"], criticalActionExpectations: [], forbiddenEffects: ["remote push"],
      environmentAssumptions: ["PostgreSQL"], externalServiceAssumptions: [], budget: { ceiling: "100 USD", reportingExpectations: ["report"], stoppingConditions: ["stop"] },
    };
    const contract = await createDurableTaskContract(pool, contractId, substance);
    await recordExactTaskContractConfirmation(pool, contractId, contract.version, contract.contentHash, "ceo");
    await launchConfirmedTaskContract(pool, contractId);
    const { kernel: executionKernel } = kernel();
    const { git: testGit, createBranch } = gitPort();
    process.env.MAESTRO_WORKTREE_ROOT = "/tmp";
    const controlPlane = createControlPlane({ databaseUrl: scopedUrl, evidenceDir: "/tmp/maestro-evidence", worktreeRoot: "/tmp", host: "127.0.0.1", port: 0, primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `council-api-${randomUUID()}` }, { executionKernel, gitPort: testGit });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: `Bearer ${credentialId}.${secret}`, "content-type": "application/json" };
    try {
      const send = (path: string, method: string, body: unknown, command = randomUUID()) => fetch(`${baseUrl}${path}`, { method, headers: { ...auth, "idempotency-key": command }, body: JSON.stringify(body) });
      expect((await send("/v1/goals", "POST", { projectId, contractId }, goalId)).status).toBe(201);
      for (const [expectedVersion, to] of [[1, "ready_for_confirmation"], [2, "launched"], [3, "active"]] as const) expect((await send(`/v1/goals/${goalId}/transitions`, "POST", { projectId, expectedVersion, to })).status).toBe(200);
      const goalBranch = await send(`/v1/goals/${goalId}/git/integration-branch`, "POST", { projectId, repositoryPath: repository, branchName: "goal/integration", baseRevision: "b".repeat(40) });
      if (goalBranch.status !== 201) console.log("goal branch failure", goalBranch.status, await goalBranch.clone().text());
      expect(goalBranch.status).toBe(201);
      expect(await goalBranch.json()).toMatchObject({ goalId, repositoryPath: repository, branchName: "goal/integration" });
      expect(createBranch).toHaveBeenCalledWith(repository, "goal/integration", "b".repeat(40));
      const activation = (departmentId: string) => ({ projectId, departmentId, contractId, requestedContribution: `own ${departmentId}`, urgency: "normal", contextScope: ["confirmed contract"], budgetEffect: "within envelope", reason: "prepare council" });
      expect((await send(`/v1/goals/${goalId}/head-participations`, "POST", activation("product"))).status).toBe(200);
      expect((await send(`/v1/goals/${goalId}/head-participations`, "POST", activation("quality"))).status).toBe(200);
      const evidenceIds = [randomUUID(), randomUUID()];
      for (const evidenceId of evidenceIds) await pool.query("INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, 'api-test', $6, 0, 'test-result', 'text/plain', 'project_lifetime')", [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "0".repeat(64)]);
      const councilResponse = await send(`/v1/goals/${goalId}/councils`, "POST", { projectId, contractId, briefDeadline: new Date(Date.now() + 60_000).toISOString(), evidence: { references: evidenceIds } });
      expect(councilResponse.status).toBe(201);
      const council = await councilResponse.json() as { councilId: string; state: string };
      const brief = { interpretation: "safe", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };
      for (const departmentId of ["product", "quality"]) expect((await send(`/v1/councils/${council.councilId}/briefs/${departmentId}`, "POST", { projectId, brief })).status).toBe(204);
      expect((await send(`/v1/councils/${council.councilId}/reveal`, "POST", { projectId })).status).toBe(204);
      const packet = { outcome: "decided", executionDisposition: "executable", selectedDirection: "ship the bounded change", rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "implement" }, { departmentId: "quality", responsibility: "certify" }], workerPlan: [], completionCriteria: ["tests pass"], failureCriteria: ["tests fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [] };
      const decided = await send(`/v1/councils/${council.councilId}/decision`, "POST", { projectId, packet });
      expect(decided.status).toBe(200);
      expect(await decided.json()).toMatchObject({ councilId: council.councilId, goalId, contractId, state: "resolved" });
      const departmentBranch = await send(`/v1/councils/${council.councilId}/departments/product/git/branch`, "POST", { projectId });
      expect(departmentBranch.status).toBe(201);
      expect(await departmentBranch.json()).toMatchObject({ goalId, departmentId: "product", branchName: "department/product" });
      const plan = {
        contribution: "implement the bounded change", nonGoals: ["unrelated work"],
        items: [{ itemId: "exec-1", kind: "execution", objective: "implement", dependsOn: [], scoutQuestion: "", workerAssignment: "implement and validate", evidenceReferences: [] }],
        requiredHandoffs: [], budgetCeiling: "50 USD", expectedTime: "1 hour", maxRetries: 1, maxWorkers: 1,
        gitRepository: repository, gitBranch: "goal/product", integrationPath: "src", risks: [], safePausePoints: ["before commit"],
        escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
      };
      const planResponse = await send(`/v1/councils/${council.councilId}/departments/product/plan`, "POST", { projectId, substance: plan });
      expect(planResponse.status).toBe(201);
      expect(await planResponse.json()).toMatchObject({ councilId: council.councilId, departmentId: "product", goalId, version: 1, substance: plan });
      const readPlan = await fetch(`${baseUrl}/v1/councils/${council.councilId}/departments/product/plan?projectId=${projectId}`, { headers: { authorization: `Bearer ${credentialId}.${secret}` } });
      expect(readPlan.status).toBe(200);
      expect((await readPlan.json()).contentHash).toMatch(/^[a-f0-9]{64}$/);
      const bundle = {
        role: "execution", profileRef: "profile/product", goalBrief: "implement the selected direction", approvedModels: ["test-model"],
        allowedSkills: ["testing"], allowedTools: ["git"], allowedPaths: ["src"], environment: ["test"], authorityBoundary: ["local commit"],
        externalServiceBoundary: ["none"], dataBoundary: ["repository only"], costCeiling: "20 USD", timeCeiling: "30 minutes", retryCeiling: 1,
        workerCeiling: 0, deliverable: "implemented change", evidenceRequirements: ["test result"], validationCriteria: ["tests pass"], terminationConditions: ["done"],
      };
      const bundleResponse = await send(`/v1/councils/${council.councilId}/departments/product/mission-bundles/exec-1`, "POST", { projectId, substance: bundle });
      expect(bundleResponse.status).toBe(201);
      expect(await bundleResponse.json()).toMatchObject({ councilId: council.councilId, departmentId: "product", planVersion: 1, itemId: "exec-1", substance: bundle });
      const readBundle = await fetch(`${baseUrl}/v1/councils/${council.councilId}/departments/product/mission-bundles/exec-1?projectId=${projectId}&planVersion=1`, { headers: { authorization: `Bearer ${credentialId}.${secret}` } });
      expect(readBundle.status).toBe(200);
      expect((await readBundle.json()).contentHash).toMatch(/^[a-f0-9]{64}$/);
      const workerResponse = await send(`/v1/councils/${council.councilId}/departments/product/workers`, "POST", { projectId, planVersion: 1, itemId: "exec-1" });
      expect(workerResponse.status).toBe(201);
      const worker = await workerResponse.json();
      expect(worker).toMatchObject({ councilId: council.councilId, departmentId: "product", planVersion: 1, itemId: "exec-1", attempt: 1, status: "spawned" });
      const readWorker = await fetch(`${baseUrl}/v1/workers/${worker.workerId}?projectId=${projectId}`, { headers: { authorization: `Bearer ${credentialId}.${secret}` } });
      expect(readWorker.status).toBe(200);
      expect((await readWorker.json()).workerId).toBe(worker.workerId);
      const observed = await send(`/v1/workers/${worker.workerId}/observe`, "POST", { projectId });
      expect(observed.status).toBe(200);
      expect((await observed.json()).status).toBe("unknown");
      // An empty provider observation is conservatively unknown. Make the
      // fixture's next transition explicit so the subsequent retry is legal.
      executionKernel.cancel = async () => ({ cancelled: true });
      const cancelled = await send(`/v1/workers/${worker.workerId}/cancel`, "POST", { projectId });
      expect(cancelled.status).toBe(200);
      expect((await cancelled.json()).status).toBe("cancelled");
      const secondWorkerResponse = await send(`/v1/councils/${council.councilId}/departments/product/workers`, "POST", { projectId, planVersion: 1, itemId: "exec-1" });
      expect(secondWorkerResponse.status).toBe(201);
      const secondWorker = await secondWorkerResponse.json();
      await pool.query("UPDATE workers SET status = 'succeeded' WHERE worker_id = $1", [secondWorker.workerId]);
      await pool.query("INSERT INTO worker_worktrees (worker_id, repository_path, worktree_path, branch_name, base_branch_name) VALUES ($1, '/tmp', $2, $3, 'department/product')", [secondWorker.workerId, `/tmp/${secondWorker.workerId}`, `worker/${secondWorker.workerId}`]);
      const commitSha = "d".repeat(40);
      await pool.query("INSERT INTO integration_commits (commit_id, worker_id, commit_sha, message, evidence_references) VALUES ($1, $2, $3, 'implemented', $4::jsonb)", [randomUUID(), secondWorker.workerId, commitSha, JSON.stringify([evidenceIds[0]])]);
      const accepted = await send(`/v1/workers/${secondWorker.workerId}/accept`, "POST", { projectId, reason: "reviewed output" });
      expect(accepted.status).toBe(201);
      const revision = await send(`/v1/goals/${goalId}/git/integration-revision`, "POST", { projectId });
      expect(revision.status).toBe(201);
      const certified = await send(`/v1/workers/${secondWorker.workerId}/certifications/quality`, "POST", { projectId, certifyingDepartmentId: "quality", substance: { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[1]] } });
      expect(certified.status).toBe(201);
      expect(await certified.json()).toMatchObject({ kind: "quality", workerId: secondWorker.workerId, verdict: "passed", certifiedByDepartment: "quality" });
      const scan = await send(`/v1/goals/${goalId}/metronome/scan`, "POST", { projectId });
      expect(scan.status).toBe(200);
      expect(await scan.json()).toEqual({ findings: [] });
      const challenge = await send(`/v1/goals/${goalId}/metronome/challenges`, "POST", { projectId, findingIds: [], reason: "request a recorded review", evidenceReferences: [evidenceIds[0]] });
      expect(challenge.status).toBe(201);
      expect(await challenge.json()).toMatchObject({ goalId, status: "open", raisedBy: "encore-metronome" });
      const read = await fetch(`${baseUrl}/v1/councils/${council.councilId}?projectId=${projectId}`, { headers: { authorization: `Bearer ${credentialId}.${secret}` } });
      expect(read.status).toBe(200);
      expect((await read.json()).state).toBe("resolved");
    } finally { await controlPlane.close(); }
  });

});
