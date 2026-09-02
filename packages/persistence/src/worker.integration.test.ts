import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type InvocationObservation, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease, executeGoalCommand } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { cancelWorker, observeWorker, readWorker, spawnWorker, WorkerError, WorkerNotFoundError } from "./worker.js";
import { reconcileOnStartup } from "./reconciliation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0014_head_activation_runtime_safety.sql", "0015_council_protocol.sql", "0016_council_hardening.sql", "0018_role_identity_hardening.sql", "0019_council_authority_hardening.sql", "0020_head_role_identity_hardening.sql", "0021_council_round_idempotency.sql", "0022_department_plans.sql", "0023_mission_bundles.sql", "0024_workers.sql"];

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
function fakeKernel(finalStatus: InvocationObservation["status"] = "succeeded"): ExecutionKernelPort & { spawnedCount: number; cancelledInvocations: string[] } {
  let counter = 0;
  const invocations = new Map<string, { execution: string; name: string }>();
  return {
    spawnedCount: 0,
    cancelledInvocations: [],
    async spawn(request) {
      counter += 1;
      const execution = `exec-${counter}`;
      const invocation = `inv-${counter}`;
      invocations.set(invocation, { execution, name: request.name });
      (this as { spawnedCount: number }).spawnedCount += 1;
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

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE reconciler_leader_lease, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("spawns a worker for a real Mission Bundle by the captured Head and observes it to a terminal state", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    expect(worker.status).toBe("spawned");
    expect(worker.attempt).toBe(1);
    const observed = await observeWorker(pool, kernel, worker.workerId);
    expect(observed.status).toBe("succeeded");
    expect(observed.answerText).toBe("done");
    expect(observed.usageTotalTokens).toBe(42);
    const reobserved = await observeWorker(pool, kernel, worker.workerId);
    expect(reobserved).toEqual(observed);
  });

  it("reconciles a genuinely mid-flight worker after a fresh control-plane restart without duplicate effects or stale authority reuse", async () => {
    const { council, plan, proof, goalId, projectId } = await setupBundle();
    const preRestartKernel = fakeKernel("running");
    const worker = await spawnWorker(pool, preRestartKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    const captured = await observeWorker(pool, preRestartKernel, worker.workerId);
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
    await observeWorker(pool, failingKernel, first.workerId);
    const second = await spawnWorker(pool, failingKernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    expect(second.attempt).toBe(2);
    await observeWorker(pool, failingKernel, second.workerId);
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
    const observedAfterCancel = await observeWorker(pool, kernel, worker.workerId);
    expect(observedAfterCancel.status).toBe("cancelled");
  });

  it("rejects direct tampering with immutable worker identity/binding and terminal status", async () => {
    const { council, plan, proof } = await setupBundle();
    const kernel = fakeKernel("succeeded");
    const worker = await spawnWorker(pool, kernel, { councilId: council.councilId, departmentId: "product", planVersion: plan.version, itemId: "scout-1" }, proof, headContext("product"));
    await observeWorker(pool, kernel, worker.workerId);
    await expect(pool.query("UPDATE workers SET status = 'failed' WHERE worker_id = $1", [worker.workerId])).rejects.toThrow();
    await expect(pool.query("UPDATE workers SET execution_ref = 'tampered' WHERE worker_id = $1", [worker.workerId])).rejects.toThrow();
  });

  it("throws WorkerNotFoundError for a missing worker", async () => {
    await expect(readWorker(pool, randomUUID())).rejects.toBeInstanceOf(WorkerNotFoundError);
  });
});
