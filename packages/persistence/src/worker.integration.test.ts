import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type InvocationObservation, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease, executeGoalCommand } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { bindWorkerInvocation, cancelUnboundWorkerAfterBindingFailure, cancelWorker, markWorkerTerminal, markWorkerUnknown, observeWorker, promptWorkerUnderOwnerClaim, readWorker, recoverWorkerAfterRestart, spawnWorker, WorkerError, WorkerNotFoundError } from "./worker.js";
import { reconcileOnStartup } from "./reconciliation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function buildContractContent(projectId: string): TaskContractSubstance {
  return {
    desiredOutcome: "deliver safely",
    userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
    project: { projectId, repository: "repo", immutableBaseRevision: "base", dataBoundary: "local" },
    evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
    budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
  };
}
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };
const evidence = { references: [randomUUID(), randomUUID()] };
const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });

const planSubstance = (): DepartmentPlanSubstance => ({
  contribution: "own the product slice", nonGoals: [],
  items: [{ itemId: "scout-1", kind: "scout", objective: "assess risk", dependsOn: [], scoutQuestion: "what changed?", workerAssignment: "", evidenceReferences: [] }],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
});
const bundleSubstance = (overrides: Partial<MissionBundleSubstance> = {}): MissionBundleSubstance => ({
  role: "scout", profileRef: "profile-1", goalBrief: "assess risk before implementation",
  approvedModels: ["model-a"], allowedSkills: ["research"], allowedTools: ["read"], allowedPaths: ["packages/product"],
  environment: ["node24"], authorityBoundary: ["read-only"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
  costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
  deliverable: "a risk report", evidenceRequirements: ["citations"], validationCriteria: ["report reviewed"],
  terminationConditions: ["deadline passed"],
  ...overrides,
});

/** A minimal, deterministic fake standing in for a real Prime execution kernel. */
function fakeKernel(finalStatus: InvocationObservation["status"] = "succeeded"): ExecutionKernelPort & { spawnedCount: number; cancelledInvocations: string[]; releasedInvocations: string[]; spawnRequests: Parameters<ExecutionKernelPort["spawn"]>[0][] } {
  let counter = 0;
  const invocations = new Map<string, { execution: string; name: string }>();
  return {
    spawnedCount: 0,
    cancelledInvocations: [],
    releasedInvocations: [],
    spawnRequests: [],
    async spawn(request) {
      counter += 1;
      const execution = `exec-${counter}`;
      const invocation = `inv-${counter}`;
      invocations.set(invocation, { execution, name: request.name });
      (this as { spawnedCount: number }).spawnedCount += 1;
      (this as { spawnRequests: unknown[] }).spawnRequests.push(request);
      return { execution: execution as never, invocation: invocation as never };
    },
    async prompt() { /* no-op */ },
    async observe(execution) {
      const matches = [...invocations.entries()].filter(([, value]) => value.execution === (execution as unknown as string));
      return matches.map(([invocation, value]) => ({
        invocation: invocation as never, name: value.name, status: finalStatus,
        toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 42 },
        answer: finalStatus === "succeeded" ? { state: "available", text: "done" } : { state: "unavailable", reason: "snapshot-unavailable" },
      }));
    },
    async sendMessage() { /* no-op */ },
    async cancel(invocation) { (this as { cancelledInvocations: string[] }).cancelledInvocations.push(invocation as unknown as string); return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 42 }; },
    async getInvocationStatus() { return finalStatus; },
    async release(invocation) { (this as { releasedInvocations: string[] }).releasedInvocations.push(invocation as unknown as string); },
    async resume() { throw new Error("not supported by fake kernel"); },
    async reconnect() { throw new Error("not supported by fake kernel"); },
  };
}

describeDatabase("Worker lifecycle with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupBundle(departments = ["product"]) {
    const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
    const contractContent = buildContractContent(projectId);
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contractContent), taskContractContentHash(contractContent)]);
    for (const evidenceId of evidence.references) {
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
      );
    }
    for (const departmentId of departments) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"));
    for (const departmentId of departments) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const packet: DecisionPacket = {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
      rejectedAlternatives: [], departmentOwnership: departments.map((departmentId) => ({ departmentId, responsibility: "own it" })),
      workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance() }, proof, headContext("product"));
    const bundle = await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    return { goalId, contractId, projectId, proof, council: resolved, plan, bundle };
  }

  async function insertPendingWorker(councilId: string, planVersion: number, bundleContentHash: string, proof: Awaited<ReturnType<typeof acquireGoalLease>>, workerId = randomUUID()): Promise<string> {
    await pool.query(
      `INSERT INTO workers (worker_id, council_id, department_id, plan_version, item_id, bundle_content_hash, attempt, execution_ref, invocation_ref, status, owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state)
       VALUES ($1, $2, 'product', $3, 'scout-1', $4, 1, $5, $6, 'spawned', $7, $8::bigint, clock_timestamp() + interval '1 minute', clock_timestamp(), 'none')`,
      [workerId, councilId, planVersion, bundleContentHash, `pending:${workerId}:execution`, `pending:${workerId}:invocation`, proof.ownerId, proof.fencingToken],
    );
    return workerId;
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE reconciler_leader_lease, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("spawns a worker for a real Mission Bundle by the captured Head and observes it to a terminal state", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    let promptCalls = 0;
    const prompt = kernel.prompt.bind(kernel);
    kernel.prompt = async (...args) => { promptCalls += 1; await prompt(...args); };
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    expect(promptCalls).toBe(1);
    expect(worker.status).toBe("spawned");
    expect(worker.attempt).toBe(1);
    const observed = await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(observed.status).toBe("succeeded");
    expect(observed.answerText).toBe("done");
    expect(observed.usageTotalTokens).toBe(42);
    const reobserved = await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(reobserved).toEqual(observed);
  });

  it("records a pending worker identity before provider spawn", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    const spawn = kernel.spawn.bind(kernel);
    let pendingRows = 0;
    kernel.spawn = async (request) => {
      const result = await pool.query<{ count: string }>("SELECT count(*) AS count FROM workers WHERE status = 'spawned' AND execution_ref LIKE 'pending:%'");
      pendingRows = Number(result.rows[0]!.count);
      return spawn(request);
    };
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    expect(pendingRows).toBe(1);
    expect(worker.executionRef).not.toMatch(/^pending:/);
  });

  it("records an unknown ordinary worker when provider spawn fails and blocks a retry", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("running");
    kernel.spawn = async () => { throw new Error("provider process terminated"); };
    const unknown = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    expect(unknown.status).toBe("unknown");
    expect(unknown.executionRef).toMatch(/^pending:/);
    await expect(spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"))).rejects.toThrow(/unknown/);
  });

  it("replays a worker spawn by command identity and rejects changed content", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    const commandId = randomUUID();
    const request = { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1", commandId };
    const first = await spawnWorker(pool, kernel, request, proof, headContext("product"));
    const replay = await spawnWorker(pool, kernel, request, proof, headContext("product"));
    expect(replay.workerId).toBe(first.workerId);
    expect(kernel.spawnedCount).toBe(1);
    await expect(spawnWorker(pool, kernel, { ...request, itemId: "different-item" }, proof, headContext("product"))).rejects.toThrow();
  });

  it("threads the exact Mission Bundle capability grant (allowedTools/allowedSkills) through to the real spawn call (Phase 2 re-patch item 2)", async () => {
    const { council, plan, proof, bundle } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));

    expect(kernel.spawnRequests).toHaveLength(1);
    expect(kernel.spawnRequests[0]!.capabilities).toEqual({
      allowedTools: bundle.substance.allowedTools,
      allowedSkills: bundle.substance.allowedSkills,
    });
    // The exact grant, not a widened or narrowed copy.
    expect(kernel.spawnRequests[0]!.capabilities!.allowedTools).toEqual(["read"]);
    expect(kernel.spawnRequests[0]!.capabilities!.allowedSkills).toEqual(["research"]);
  });

  it("releases the kernel's in-process invocation record exactly once, only after the terminal status is durably committed (Phase 1 re-patch item 2)", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    expect(kernel.releasedInvocations).toEqual([]);

    const observed = await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(observed.status).toBe("succeeded");
    expect(kernel.releasedInvocations).toEqual([worker.invocationRef]);

    // Re-observing an already-terminal worker returns durable state directly
    // without calling the kernel again, so it must not release a second time.
    await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(kernel.releasedInvocations).toEqual([worker.invocationRef]);
  });

  it("still returns the durably committed cancellation even when the kernel's release call fails", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("running");
    (kernel as unknown as { release: () => Promise<void> }).release = async () => { throw new Error("kernel eviction backend unavailable"); };
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));

    const cancelled = await cancelWorker(pool, kernel, worker.workerId, proof, headContext("product"));

    expect(cancelled.status).toBe("cancelled");
    const stored = await readWorker(pool, worker.workerId);
    expect(stored.status).toBe("cancelled");
  });

  it("does not release a still-running worker's invocation record", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("running");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));

    const observed = await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(observed.status).toBe("running");
    expect(kernel.releasedInvocations).toEqual([]);
  });

  it("still returns the durably committed terminal observation even when the kernel's release call fails", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    (kernel as unknown as { release: () => Promise<void> }).release = async () => { throw new Error("kernel eviction backend unavailable"); };
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));

    const observed = await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));

    expect(observed.status).toBe("succeeded");
    const stored = await readWorker(pool, worker.workerId);
    expect(stored.status).toBe("succeeded");
  });

  it("reconciles a genuinely mid-flight worker after a fresh control-plane restart without duplicate effects or stale authority reuse", async () => {
    const { council, plan, proof, goalId, projectId } = await setupBundle();
    const preRestartKernel = fakeKernel("running");
    const worker = await spawnWorker(pool, preRestartKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    const captured = await observeWorker(pool, preRestartKernel, worker.workerId, proof, headContext("product"));
    expect(captured.status).toBe("running");

    // A new Pool and kernel stand in for a restarted control plane. The old
    // Goal lease is still live because the worker is genuinely in flight.
    // Reconciliation must report lease_contended rather than racing recovery:
    // protecting the active execution is the correct outcome, not a failure.
    const restartedPool = new Pool({ connectionString: databaseUrl });
    const postRestartKernel = fakeKernel("running");
    try {
      const recovery = await reconcileOnStartup(restartedPool, { ownerId: "restarted-control-plane", leaderLeaseDurationMs: 60_000, goalLeaseDurationMs: 60_000 });
      expect(recovery.results).toEqual([{
        goalId,
        projectId,
        priorState: "active",
        outcome: "lease_contended",
        reasons: ["goal_lease_held_across_reconciliation"],
        reconciledWorkerIds: [],
        reconciledHeadActivationCommandIds: [],
      }]);
      expect(await readWorker(restartedPool, worker.workerId)).toMatchObject({ workerId: worker.workerId, status: "running" });
      expect((await restartedPool.query("SELECT count(*)::int AS count FROM workers WHERE council_id = $1", [council.councilId])).rows[0].count).toBe(1);

      // Once the original lease is expired, a new owner may fence it out. The
      // pre-restart proof is stale and must be rejected before any write.
      await restartedPool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
      const successorProof = await acquireGoalLease(restartedPool, { goalId, ownerId: "restarted-owner", leaseDurationMs: 60_000 });
      await expect(executeGoalCommand(restartedPool, { commandId: randomUUID(), projectId, goalId, actorId: "old-process", type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation" }, proof)).rejects.toMatchObject({ code: "stale_lease" });
      expect(successorProof.fencingToken).not.toBe(proof.fencingToken);
      expect((await restartedPool.query("SELECT count(*)::int AS count FROM goal_events WHERE goal_id = $1", [goalId])).rows[0].count).toBe(0);
    } finally {
      await restartedPool.end();
    }
  });

  it("forces a genuinely orphaned running worker to unknown at startup once its Goal's lease has actually expired (Phase 1 re-patch item 8 part 2/2)", async () => {
    const { council, plan, proof, goalId, projectId } = await setupBundle();
    const preRestartKernel = fakeKernel("running");
    const worker = await spawnWorker(pool, preRestartKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    const captured = await observeWorker(pool, preRestartKernel, worker.workerId, proof, headContext("product"));
    expect(captured.status).toBe("running");

    // Unlike the "still contended" scenario above, this Goal's lease has
    // genuinely expired -- no other live process could still hold the real
    // session, so a fresh restarted process's brand-new kernel (which has
    // no session for this worker's execution_ref at all) may honestly
    // reconcile it.
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);

    const restartedPool = new Pool({ connectionString: databaseUrl });
    const freshKernel = fakeKernel("running"); // fresh instance: empty session/root/child state, unrelated to preRestartKernel
    try {
      const recovery = await reconcileOnStartup(restartedPool, {
        ownerId: "restarted-control-plane", leaderLeaseDurationMs: 60_000, goalLeaseDurationMs: 60_000, kernel: freshKernel,
      });
      const result = recovery.results.find((entry) => entry.goalId === goalId);
      expect(result?.reconciledWorkerIds).toEqual([worker.workerId]);

      const reconciledWorker = await readWorker(restartedPool, worker.workerId);
      expect(reconciledWorker.status).toBe("unknown");
    } finally {
      await restartedPool.end();
    }
  });

  it("does not touch a worker whose Goal lease is still live (protects, rather than prematurely reconciles, active execution)", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const kernel = fakeKernel("running");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));

    const restartedPool = new Pool({ connectionString: databaseUrl });
    const freshKernel = fakeKernel("running");
    try {
      const recovery = await reconcileOnStartup(restartedPool, {
        ownerId: "restarted-control-plane-2", leaderLeaseDurationMs: 60_000, goalLeaseDurationMs: 60_000, kernel: freshKernel,
      });
      const result = recovery.results.find((entry) => entry.goalId === goalId);
      expect(result?.outcome).toBe("lease_contended");
      expect(result?.reconciledWorkerIds).toEqual([]);

      const untouchedWorker = await readWorker(restartedPool, worker.workerId);
      expect(untouchedWorker.status).toBe("running");
    } finally {
      await restartedPool.end();
    }
  });

  it("does not attempt worker reconciliation when no kernel is supplied to reconcileOnStartup", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const kernel = fakeKernel("running");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);

    const restartedPool = new Pool({ connectionString: databaseUrl });
    try {
      const recovery = await reconcileOnStartup(restartedPool, { ownerId: "restarted-no-kernel", leaderLeaseDurationMs: 60_000, goalLeaseDurationMs: 60_000 });
      const result = recovery.results.find((entry) => entry.goalId === goalId);
      expect(result?.reconciledWorkerIds).toEqual([]);
      const untouchedWorker = await readWorker(restartedPool, worker.workerId);
      expect(untouchedWorker.status).toBe("running");
    } finally {
      await restartedPool.end();
    }
  });

  it("rejects spawning a second worker while one is already active for the same mission", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("running");
    await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await expect(spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"))).rejects.toBeInstanceOf(WorkerError);
  });

  it("allows a retry attempt after a terminal failure, bounded by the bundle's retryCeiling", async () => {
    const { council, plan, proof } = await setupBundle();
    const failingKernel = fakeKernel("failed");
    const first = await spawnWorker(pool, failingKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await observeWorker(pool, failingKernel, first.workerId, proof, headContext("product"));
    const second = await spawnWorker(pool, failingKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    expect(second.attempt).toBe(2);
    await observeWorker(pool, failingKernel, second.workerId, proof, headContext("product"));
    // bundleSubstance().retryCeiling is 1, so attempts 1 and 2 are allowed; a third is not.
    await expect(spawnWorker(pool, failingKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"))).rejects.toBeInstanceOf(WorkerError);
  });

  it("rejects spawning from an unauthorized actor", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel();
    await expect(spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, context("not-the-head"))).rejects.toBeInstanceOf(WorkerError);
  });

  it("cancels a running worker only for the captured authorized Head, and cancellation is terminal", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("running");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await expect(cancelWorker(pool, kernel, worker.workerId, proof, context("not-the-head"))).rejects.toBeInstanceOf(WorkerError);
    const cancelled = await cancelWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(cancelled.status).toBe("cancelled");
    expect(kernel.cancelledInvocations).toContain(worker.invocationRef);
    expect(kernel.releasedInvocations).toEqual([worker.invocationRef]);
    const observedAfterCancel = await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(observedAfterCancel.status).toBe("cancelled");
    // Already-terminal (cancelled) worker: observeWorker's early-return path
    // never calls the kernel again, so no second release.
    expect(kernel.releasedInvocations).toEqual([worker.invocationRef]);
  });

  it("holds the owner claim through provider cancellation before allowing takeover", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const kernel = fakeKernel("running");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() + interval '250 milliseconds' WHERE goal_id = $1", [goalId]);
    let enterCancel!: () => void;
    let releaseCancel!: () => void;
    let cancelReturned = false;
    const cancelEntered = new Promise<void>((resolve) => { enterCancel = resolve; });
    const cancelGate = new Promise<void>((resolve) => { releaseCancel = resolve; });
    kernel.cancel = async () => {
      enterCancel();
      await cancelGate;
      cancelReturned = true;
      return { cancelled: true };
    };

    const cancellation = cancelWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    await cancelEntered;
    await new Promise((resolve) => setTimeout(resolve, 350));
    let takeoverSettled = false;
    const takeover = acquireGoalLease(pool, { goalId, ownerId: "cancel-successor", leaseDurationMs: 60_000 }).then((next) => { takeoverSettled = true; return next; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(cancelReturned).toBe(false);
    expect(takeoverSettled).toBe(false);
    releaseCancel();
    const results = await Promise.allSettled([cancellation, takeover]);
    expect(results[1]!.status).toBe("fulfilled");
    expect(cancelReturned).toBe(true);
  });

  it("does not mark a worker cancelled when the provider refuses cancellation", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    kernel.cancel = async () => ({ cancelled: false });
    const result = await cancelWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(result.status).toBe("succeeded");
    expect(result.answerText).toBe("done");
  });

  it("rejects direct tampering with immutable worker identity/binding and terminal status", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    await expect(pool.query("UPDATE workers SET status = 'failed' WHERE worker_id = $1", [worker.workerId])).rejects.toThrow();
    await expect(pool.query("UPDATE workers SET execution_ref = 'tampered' WHERE worker_id = $1", [worker.workerId])).rejects.toThrow();
    await expect(pool.query("UPDATE workers SET owner_id = 'tampered-owner', owner_fencing_token = 999, owner_lease_expires_at = clock_timestamp() + interval '1 minute', recovery_state = 'fenced' WHERE worker_id = $1", [worker.workerId])).rejects.toThrow();
  });

  it("durably records the owning process, fencing proof, lease expiry, and heartbeat before provider work", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("running");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    const row = await pool.query<{ owner_id: string; owner_fencing_token: string; owner_lease_expires_at: Date; heartbeat_at: Date; recovery_state: string }>(
      "SELECT owner_id, owner_fencing_token, owner_lease_expires_at, heartbeat_at, recovery_state FROM workers WHERE worker_id = $1",
      [worker.workerId],
    );
    expect(row.rows[0]).toMatchObject({ owner_id: proof.ownerId, owner_fencing_token: proof.fencingToken, recovery_state: "none" });
    expect(row.rows[0]!.owner_lease_expires_at).toBeInstanceOf(Date);
    expect(row.rows[0]!.heartbeat_at).toBeInstanceOf(Date);
  });

  it("binds opaque provider refs after takeover without allowing stale compensation to cancel", async () => {
    const { council, plan, bundle, proof, goalId } = await setupBundle();
    const workerId = await insertPendingWorker(council.councilId, plan.version, bundle.contentHash, proof);
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    const successor = await acquireGoalLease(pool, { goalId, ownerId: "bind-successor", leaseDurationMs: 60_000 });
    await recoverWorkerAfterRestart(pool, workerId, successor, "takeover before provider binding");
    const beforeBind = await pool.query<{ heartbeat_at: Date | null }>("SELECT heartbeat_at FROM workers WHERE worker_id = $1", [workerId]);

    const kernel = fakeKernel("running");
    await expect(cancelUnboundWorkerAfterBindingFailure(pool, kernel, workerId, "inv-stale" as never, proof)).rejects.toThrow();
    expect(kernel.cancelledInvocations).toEqual([]);
    const bound = await bindWorkerInvocation(pool, workerId, { execution: "exec-survivor" as never, invocation: "inv-survivor" as never }, proof);
    expect(bound).toMatchObject({
      executionRef: "exec-survivor", invocationRef: "inv-survivor", ownerId: successor.ownerId,
      ownerFencingToken: successor.fencingToken, status: "unknown", recoveryState: "fenced",
    });
    const afterBind = await pool.query<{ heartbeat_at: Date | null }>("SELECT heartbeat_at FROM workers WHERE worker_id = $1", [workerId]);
    expect(afterBind.rows[0]!.heartbeat_at?.getTime()).toBe(beforeBind.rows[0]!.heartbeat_at?.getTime());
  });

  it("does not prompt after ownership has transferred to a successor", async () => {
    const { council, plan, bundle, proof, goalId } = await setupBundle();
    const workerId = await insertPendingWorker(council.councilId, plan.version, bundle.contentHash, proof);
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    const successor = await acquireGoalLease(pool, { goalId, ownerId: "prompt-successor", leaseDurationMs: 60_000 });
    await recoverWorkerAfterRestart(pool, workerId, successor, "takeover before prompt");
    await bindWorkerInvocation(pool, workerId, { execution: "exec-survivor" as never, invocation: "inv-survivor" as never }, proof);
    const kernel = fakeKernel("running");
    let promptCalls = 0;
    kernel.prompt = async () => { promptCalls += 1; };
    await expect(promptWorkerUnderOwnerClaim(pool, kernel, workerId, "exec-survivor" as never, "must not run", proof)).rejects.toThrow();
    expect(promptCalls).toBe(0);
  });

  it("serializes a provider observation racing successor recovery without a lock-order timeout", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const kernel = fakeKernel("running");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    const originalObserve = kernel.observe.bind(kernel);
    let entered!: () => void;
    const observed = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    kernel.observe = async (execution) => { entered(); await gate; return originalObserve(execution); };
    const observation = observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    await observed;
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    const successor = await acquireGoalLease(pool, { goalId, ownerId: "observe-successor", leaseDurationMs: 60_000 });
    const recovery = recoverWorkerAfterRestart(pool, worker.workerId, successor, "observation owner lost");
    release();
    const settled = await Promise.race([
      Promise.allSettled([observation, recovery]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("observe/recovery lock-order deadlock")), 8_000)),
    ]);
    expect(settled).toHaveLength(2);
    expect((settled as PromiseSettledResult<unknown>[])[1]!.status).toBe("fulfilled");
    expect((settled as PromiseSettledResult<unknown>[])[0]!.status).toBe("rejected");
  });

  it("reconciles an unknown provider spawn after restart and records the successor fence", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const kernel = fakeKernel("running");
    kernel.spawn = async () => { throw new Error("provider transport timed out after spawn request"); };
    const unknown = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    expect(unknown.status).toBe("unknown");
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);

    const report = await reconcileOnStartup(pool, { ownerId: "successor-unknown", kernel: fakeKernel("running") });
    expect(report.results).toMatchObject([{ outcome: "recovering", reconciledWorkerIds: [unknown.workerId] }]);
    await expect(readWorker(pool, unknown.workerId)).resolves.toMatchObject({
      status: "unknown", recoveryState: "fenced", ownerId: "reconciler:successor-unknown",
    });
    const decisions = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM worker_recovery_decisions WHERE worker_id = $1", [unknown.workerId]);
    expect(decisions.rows[0]!.count).toBe(1);
  });

  it("serializes recovery and a concurrent spawn without a deadlock or duplicate provider effect", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const oldKernel = fakeKernel("running");
    const worker = await spawnWorker(pool, oldKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    const successor = await acquireGoalLease(pool, { goalId, ownerId: "concurrent-successor", leaseDurationMs: 60_000 });
    const successorKernel = fakeKernel("running");

    const settled = await Promise.race([
      Promise.allSettled([
        recoverWorkerAfterRestart(pool, worker.workerId, successor, "concurrent restart recovery"),
        spawnWorker(pool, successorKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, successor, headContext("product")),
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("recovery/spawn lock-order deadlock")), 8_000)),
    ]);
    expect(settled).toHaveLength(2);
    const decisions = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM worker_recovery_decisions WHERE worker_id = $1", [worker.workerId]);
    expect(decisions.rows[0]!.count).toBe(1);
    expect(successorKernel.spawnedCount).toBe(0);
  });

  it("fences an expired worker owner once, records one recovery decision, and blocks retry", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const preRestartKernel = fakeKernel("running");
    const worker = await spawnWorker(pool, preRestartKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    const successor = await acquireGoalLease(pool, { goalId, ownerId: "successor", leaseDurationMs: 60_000 });

    const recovered = await recoverWorkerAfterRestart(pool, worker.workerId, successor, "provider session is unavailable after owner restart");
    expect(recovered.status).toBe("unknown");
    expect(recovered.ownerId).toBe("successor");
    expect(recovered.recoveryState).toBe("fenced");
    const replay = await recoverWorkerAfterRestart(pool, worker.workerId, successor, "same recovery replay");
    expect(replay).toEqual(recovered);
    const decisions = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM worker_recovery_decisions WHERE worker_id = $1", [worker.workerId]);
    expect(decisions.rows[0]!.count).toBe(1);
    await expect(pool.query("DELETE FROM worker_recovery_decisions WHERE worker_id = $1", [worker.workerId])).rejects.toThrow(/append-only/);
    await expect(spawnWorker(pool, preRestartKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, successor, headContext("product"))).rejects.toThrow(/unknown/);
  });

  it("rejects every stale-owner worker write after successor fencing", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const worker = await spawnWorker(pool, fakeKernel("running"), { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    const successor = await acquireGoalLease(pool, { goalId, ownerId: "stale-write-successor", leaseDurationMs: 60_000 });
    await recoverWorkerAfterRestart(pool, worker.workerId, successor, "successor owns the worker");

    await expect(markWorkerUnknown(pool, worker.workerId, proof)).rejects.toThrow();
    await expect(markWorkerTerminal(pool, worker.workerId, "cancelled", proof)).rejects.toThrow();
    await expect(readWorker(pool, worker.workerId)).resolves.toMatchObject({
      status: "unknown", recoveryState: "fenced", ownerId: successor.ownerId, ownerFencingToken: successor.fencingToken,
    });
  });

  it("rejects the old owner after restart fencing without changing the successor-owned row", async () => {
    const { council, plan, proof, goalId } = await setupBundle();
    const oldKernel = fakeKernel("running");
    const worker = await spawnWorker(pool, oldKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await pool.query("UPDATE goal_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE goal_id = $1", [goalId]);
    const successor = await acquireGoalLease(pool, { goalId, ownerId: "successor-observer", leaseDurationMs: 60_000 });
    await recoverWorkerAfterRestart(pool, worker.workerId, successor, "old owner is gone");
    await expect(observeWorker(pool, oldKernel, worker.workerId, proof, headContext("product"))).rejects.toThrow();
    await expect(readWorker(pool, worker.workerId)).resolves.toMatchObject({ status: "unknown", ownerId: successor.ownerId, ownerFencingToken: successor.fencingToken });
  });

  it("persists cancellation intent before provider cancellation", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("running");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    let intentSeen = false;
    const cancel = kernel.cancel.bind(kernel);
    kernel.cancel = async (invocation) => {
      const result = await pool.query<{ cancellation_requested_at: Date | null; cancellation_owner_id: string | null; cancellation_fencing_token: string | null }>(
        "SELECT cancellation_requested_at, cancellation_owner_id, cancellation_fencing_token FROM workers WHERE worker_id = $1",
        [worker.workerId],
      );
      intentSeen = result.rows[0]!.cancellation_requested_at instanceof Date
        && result.rows[0]!.cancellation_owner_id === proof.ownerId
        && result.rows[0]!.cancellation_fencing_token === proof.fencingToken;
      return cancel(invocation);
    };
    const cancelled = await cancelWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(intentSeen).toBe(true);
    expect(cancelled.status).toBe("cancelled");
  });

  it("throws WorkerNotFoundError for a missing worker", async () => {
    await expect(readWorker(pool, randomUUID())).rejects.toBeInstanceOf(WorkerNotFoundError);
  });
});
