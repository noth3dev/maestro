import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localGitPort } from "@maestro/git-adapter";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease, executeGoalCommand } from "./commands.js";
import { createDurableTaskContract, launchConfirmedTaskContract, recordExactTaskContractConfirmation } from "./task-contract.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { observeWorker, spawnWorker } from "./worker.js";
import { assembleEvidenceBundle, EvidenceBundleNotFoundError, readEvidenceBundle, recordEvidenceBundle, verifyStoredEvidenceBundle } from "./evidence-bundle.js";
import { recordDepartmentBranch, recordGoalIntegrationBranch, recordIntegrationCommit, recordWorkerWorktree } from "./git-integration.js";
import { reserveDepartmentBudget, reserveGoalBudget, reserveMissionBudget } from "./budget-reservation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0014_head_activation_runtime_safety.sql", "0015_council_protocol.sql", "0016_council_hardening.sql", "0018_role_identity_hardening.sql", "0019_council_authority_hardening.sql", "0020_head_role_identity_hardening.sql", "0021_council_round_idempotency.sql", "0022_department_plans.sql", "0023_mission_bundles.sql", "0024_workers.sql", "0025_team_lead_grants.sql", "0026_git_integration.sql", "0027_budget_reservations.sql", "0035_evidence_bundles.sql"];

const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };

function fakeKernel(): ExecutionKernelPort {
  let counter = 0;
  const invocations = new Map<string, { execution: string }>();
  return {
    async spawn() { counter += 1; const execution = `exec-${counter}`; const invocation = `inv-${counter}`; invocations.set(invocation, { execution }); return { execution: execution as never, invocation: invocation as never }; },
    async prompt() {}, async sendMessage() {},
    async observe(execution) {
      const matches = [...invocations.entries()].filter(([, v]) => v.execution === (execution as unknown as string));
      return matches.map(([invocation]) => ({ invocation: invocation as never, name: "worker", status: "succeeded" as const, toolEvents: { state: "empty" as const, events: [] }, usage: { state: "available" as const, totalTokens: 10 }, answer: { state: "available" as const, text: "implemented" } }));
    },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 10 }; },
    async getInvocationStatus() { return "succeeded"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("Phase 2 work-sequence step 12: one real local Goal through the full integrated chain", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let repositoryPath: string;
  let baseRevision: string;
  const worktreePaths: string[] = [];

  beforeEach(() => {
    repositoryPath = mkdtempSync(join(tmpdir(), "maestro-e2e-goal-"));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: repositoryPath });
    baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
  });
  afterEach(() => {
    for (const path of worktreePaths.splice(0)) rmSync(path, { recursive: true, force: true });
    rmSync(repositoryPath, { recursive: true, force: true });
  });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS evidence_bundles, budget_forecasts, budget_reservations, integration_commits, worker_worktrees, department_branches, goal_integration_branches, team_lead_grants, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE evidence_bundles, budget_forecasts, budget_reservations, integration_commits, worker_worktrees, department_branches, goal_integration_branches, team_lead_grants, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("assembles a durable evidence bundle spanning Task Contract, Council, Plan, Worker, Git, Budget, and verifies its integrity", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "control-plane", leaseDurationMs: 120_000 });

    // 1. Durable Goal command lifecycle: draft -> ready_for_confirmation -> launched -> active.
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "CreateGoal", expectedVersion: 0 }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 1, to: "ready_for_confirmation" }, proof);
    await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 2, to: "launched" }, proof);
    const active = await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 3, to: "active" }, proof);
    expect(active.outcome).toBe("succeeded");

    // 2. Task Contract: create, exact-confirm, launch.
    const contractId = randomUUID();
    const substance: TaskContractSubstance = {
      desiredOutcome: "ship a small, safe local change", userVisibleBehavior: ["CEO sees a confirmed plan"], successCriteria: ["change is integrated"], liveEvidence: ["Phase 2 end-to-end test"],
      scope: ["one bounded change"], nonGoals: ["unrelated refactors"], priorities: ["safety", "correctness"], acceptableTradeoffs: ["no UI"], constraints: ["local only"], knownEdgeCases: ["none"],
      project: { projectId, repository: repositoryPath, immutableBaseRevision: baseRevision, dataBoundary: "repository files only" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: ["Product Group"], expectedDepartments: ["Product Department"],
      criticalActionExpectations: ["none"], forbiddenEffects: ["remote push"], environmentAssumptions: ["PostgreSQL"], externalServiceAssumptions: ["none"],
      budget: { ceiling: "1000 USD", reportingExpectations: ["on launch"], stoppingConditions: ["ceiling reached"] },
    };
    const contract = await createDurableTaskContract(pool, contractId, substance);
    await recordExactTaskContractConfirmation(pool, contractId, contract.version, contract.contentHash, "ceo");
    const launched = await launchConfirmedTaskContract(pool, contractId);
    expect(launched.launchState).toBe("launched");

    // 3. One Head activates for the Product Department (established durable-participation pattern used throughout Phase 2 P2S5-P2S11).
    await pool.query(
      "INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'opaque:product')",
      [goalId, contractId],
    );

    // 4. Head Council: seal, reveal, decide (executable).
    const evidenceIds = [randomUUID(), randomUUID()];
    for (const evidenceId of evidenceIds) {
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
      );
    }
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: evidenceIds } }, proof, context("secretary"));
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const packet: DecisionPacket = {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "implement the bounded change",
      rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "own the change" }],
      workerPlan: [], completionCriteria: ["tests pass"], failureCriteria: ["tests fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    expect(resolved.state).toBe("resolved");

    // 5. Department Plan, owned by the Product Head, bound to the resolved decision.
    const planSubstance: DepartmentPlanSubstance = {
      contribution: "implement the bounded change", nonGoals: [],
      items: [{ itemId: "exec-1", kind: "execution", objective: "implement the change", dependsOn: [], scoutQuestion: "", workerAssignment: "implement and commit the change", evidenceReferences: [] }],
      requiredHandoffs: [], budgetCeiling: "500 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
      gitRepository: repositoryPath, gitBranch: "phase2/product", integrationPath: "packages/product",
      risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
    };
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance }, proof, headContext("product"));

    // 6. Mission Bundle: least-privilege capability grant for the execution item.
    const bundleSubstance: MissionBundleSubstance = {
      role: "execution", profileRef: "profile-1", goalBrief: "implement and commit the change",
      approvedModels: ["model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/product"],
      environment: ["node24"], authorityBoundary: ["write-scoped"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
      costCeiling: "100 USD", timeCeiling: "1 day", retryCeiling: 1, workerCeiling: 0,
      deliverable: "an implemented, committed change", evidenceRequirements: ["diff"], validationCriteria: ["tests pass"],
      terminationConditions: ["deadline passed"],
    };
    await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance }, proof, headContext("product"));

    // 7. Worker: spawn through the execution kernel, observe to a terminal success.
    const kernel = fakeKernel();
    const worker = await spawnWorker(pool, kernel, { councilId: resolved.councilId, departmentId: "product", planVersion: plan.version, itemId: "exec-1" }, proof, headContext("product"));
    const observedWorker = await observeWorker(pool, kernel, worker.workerId);
    expect(observedWorker.status).toBe("succeeded");

    // 8. Git integration: real Goal branch, Department branch, worker worktree, and a real commit.
    await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    await recordDepartmentBranch(pool, localGitPort, resolved.councilId, "product", proof, headContext("product"));
    const worktreePath = join(repositoryPath, "..", `maestro-e2e-worker-${randomUUID()}`);
    worktreePaths.push(worktreePath);
    await recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, headContext("product"));
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(worktreePath, "change.txt"), "the bounded mission-only change");
    const commitResult = await localGitPort.commit(worktreePath, "mission: implement the bounded change", "worker", "worker@example.com");
    const recordedCommit = await recordIntegrationCommit(pool, worker.workerId, commitResult.commitSha, "mission: implement the bounded change", evidenceIds);
    expect(recordedCommit.commitSha).toBe(commitResult.commitSha);

    // 9. Budget: Goal envelope, Department allocation, Mission allocation.
    await reserveGoalBudget(pool, goalId, 100_000, "initial envelope", proof, context("secretary"));
    await reserveDepartmentBudget(pool, resolved.councilId, "product", 50_000, "product allocation", proof, headContext("product"));
    const missionReservation = await reserveMissionBudget(pool, resolved.councilId, "product", plan.version, "exec-1", 10_000, "execution mission", proof, headContext("product"));
    expect(missionReservation.amountCents).toBe(10_000);

    // 10. Stop at "awaiting certification" (certifying), not final succeeded/failed -- per plan/phase2.md work-sequence step 12.
    const certifying = await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId, actorId: "sane", type: "TransitionGoal", expectedVersion: 4, to: "certifying" }, proof);
    expect(certifying.outcome).toBe("succeeded");
    const finalGoal = await pool.query<{ state: string }>("SELECT state FROM goals WHERE goal_id = $1", [goalId]);
    expect(finalGoal.rows[0]!.state).toBe("certifying");

    // Assemble and durably record the evidence bundle spanning everything above.
    const { bundleId, hash } = await recordEvidenceBundle(pool, goalId);
    await verifyStoredEvidenceBundle(pool, bundleId);
    const read = await readEvidenceBundle(pool, bundleId);
    expect(read.hash).toBe(hash);
    expect(read.content.taskContract).not.toBeNull();
    expect(read.content.council).not.toBeNull();
    expect(read.content.departmentPlans.length).toBeGreaterThan(0);
    expect(read.content.workers.length).toBeGreaterThan(0);
    expect((read.content.gitIntegration as { commits: unknown[] }).commits.length).toBeGreaterThan(0);
    expect(read.content.budgetReservations.length).toBeGreaterThan(0);

    // A live re-assembly right now reflects the same durable state and hashes identically.
    const reassembled = await assembleEvidenceBundle(pool, goalId);
    expect(reassembled.hash).toBe(hash);

    // The bundle is immutable at the database level: direct tampering is rejected outright, not merely detected after the fact.
    await expect(pool.query("UPDATE evidence_bundles SET content = jsonb_set(content, '{workers}', '[]'::jsonb) WHERE bundle_id = $1", [bundleId])).rejects.toThrow();
  });

  it("throws EvidenceBundleNotFoundError for a missing bundle", async () => {
    await expect(readEvidenceBundle(pool, randomUUID())).rejects.toBeInstanceOf(EvidenceBundleNotFoundError);
  });
});
