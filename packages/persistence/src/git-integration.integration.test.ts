import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localGitPort } from "../../../test/git-port.js";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease, StaleGoalLeaseError } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { observeWorker, sendWorkerMessageUnderOwnerClaim, spawnWorker } from "./worker.js";
import { GitIntegrationError, advanceWorkerIntegration, getGoalGitIntegrationState, recordDepartmentBranch, recordGoalIntegrationBranch, recordGoalIntegrationRevision, recordIntegrationCommit, recordWorkerWorktree } from "./git-integration.js";
import { acceptDepartmentWorkerOutput, certifyQuality } from "./certification.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function buildContractContent(projectId: string, repositoryPath: string): TaskContractSubstance {
  return {
    desiredOutcome: "deliver safely",
    userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
    project: { projectId, repository: repositoryPath, immutableBaseRevision: "base", dataBoundary: "local" },
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
  items: [{ itemId: "exec-1", kind: "execution", objective: "implement", dependsOn: [], scoutQuestion: "", workerAssignment: "implement the fix", evidenceReferences: [] }],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
});
const bundleSubstance = (): MissionBundleSubstance => ({
  role: "execution", profileRef: "profile-1", goalBrief: "implement the fix",
  taskDemand: { schemaVersion: 1, taskKinds: ["coding"], requirements: { reasoning: { level: 80, rationale: "The Head set this level from the Task Contract." }, coding: { level: 80, rationale: "The Head set this level from the Task Contract." }, verification: { level: 80, rationale: "The Head set this level from the Task Contract." }, "instruction-fidelity": { level: 80, rationale: "The Head set this level from the Task Contract." }, "tool-use": { level: 80, rationale: "The Head set this level from the Task Contract." }, "long-context": { level: 80, rationale: "The Head set this level from the Task Contract." }, knowledge: { level: 80, rationale: "The Head set this level from the Task Contract." }, "refusal-calibration": { level: 80, rationale: "The Head set this level from the Task Contract." } }, provenance: { taskContractRef: "task-contract:fixture", headDecisionRef: "head-decision:fixture" } },
  approvedModels: ["test/model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/product"],
  environment: ["node24"], authorityBoundary: ["write-scoped"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
  costCeiling: "5 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
  deliverable: "an implemented change", evidenceRequirements: ["diff"], validationCriteria: ["tests pass"],
  terminationConditions: ["deadline passed"],
});

function fakeKernel(status: "running" | "succeeded" = "running"): ExecutionKernelPort & { readonly admissions: readonly Record<string, unknown>[] } {
  let counter = 0;
  const admissions: Record<string, unknown>[] = [];
  return {
    async spawn(request) { admissions.push(request as Record<string, unknown>); counter += 1; return { execution: `exec-${counter}` as never, invocation: `inv-${counter}` as never }; },
    async prompt() {}, async sendMessage() {}, async observe() { return []; },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 1 }; },
    async getInvocationStatus() { return status; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
    admissions,
  };
}

describeDatabase("Git integration evidence with PostgreSQL and a real local repository", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let repositoryPath: string;
  let baseRevision: string;
  const worktreePaths: string[] = [];

  beforeEach(() => {
    repositoryPath = mkdtempSync(join(tmpdir(), "maestro-git-integration-"));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: repositoryPath });
    baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
  });
  afterEach(() => {
    for (const path of worktreePaths.splice(0)) rmSync(path, { recursive: true, force: true });
    rmSync(repositoryPath, { recursive: true, force: true });
  });

  async function setupPlan(departments = ["product"], ownedDepartments = departments, targetBound = false) {
    const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
    const contractContent = buildContractContent(projectId, repositoryPath);
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
      rejectedAlternatives: [], departmentOwnership: ownedDepartments.map((departmentId) => ({ departmentId, responsibility: "own it" })),
      workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance() }, proof, headContext("product"));
    await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance() }, proof, headContext("product"));
    const kernel = fakeKernel(targetBound ? "succeeded" : "running");
    let targetWorktreePath: string | undefined;
    if (targetBound) {
      await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
      await recordDepartmentBranch(pool, localGitPort, resolved.councilId, "product", proof, headContext("product"));
      targetWorktreePath = join(repositoryPath, "..", `maestro-target-worker-${randomUUID()}`);
      worktreePaths.push(targetWorktreePath);
    }
    const worker = await spawnWorker(pool, kernel, {
      councilId: resolved.councilId, departmentId: "product", planVersion: plan.version, itemId: "exec-1",
      ...(targetWorktreePath === undefined ? {} : { prepareWorktree: (workerId: string) => recordWorkerWorktree(pool, localGitPort, workerId, targetWorktreePath!, proof, headContext("product")).then((result) => result.worktreePath) }),
    }, proof, headContext("product"));
    return { goalId, proof, council: resolved, worker, kernel, targetWorktreePath };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS integration_commits, worker_worktrees, department_branches, goal_integration_branches, team_lead_grants, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE integration_commits, worker_worktrees, department_branches, goal_integration_branches, team_lead_grants, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates the real Goal integration branch, Department branch, and worker worktree in sequence and records durable evidence", async () => {
    const { goalId, council, worker, proof } = await setupPlan();
    const goalBranch = await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    expect(goalBranch.branchName).toBe("goal/integration");
    const replay = await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    expect(replay).toEqual(goalBranch);

    const deptBranch = await recordDepartmentBranch(pool, localGitPort, council.councilId, "product", proof, headContext("product"));
    expect(deptBranch.baseBranchName).toBe("goal/integration");
    const deptSha = execFileSync("git", ["rev-parse", deptBranch.branchName], { cwd: repositoryPath }).toString().trim();
    expect(deptSha).toBe(baseRevision);

    const worktreePath = join(repositoryPath, "..", `maestro-worker-${randomUUID()}`);
    worktreePaths.push(worktreePath);
    const workerWorktree = await recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, headContext("product"));
    expect(workerWorktree.baseBranchName).toBe(deptBranch.branchName);

    const fs = await import("node:fs/promises");
    await fs.writeFile(join(worktreePath, "change.txt"), "mission-only change");
    const commitResult = await localGitPort.commit(worktreePath, "mission: add change", "worker", "worker@example.com");
    const recorded = await recordIntegrationCommit(pool, worker.workerId, commitResult.commitSha, "mission: add change", [...evidence.references]);
    expect(recorded.commitSha).toBe(commitResult.commitSha);
    const replayCommit = await recordIntegrationCommit(pool, worker.workerId, commitResult.commitSha, "mission: add change", [...evidence.references]);
    expect(replayCommit).toEqual(recorded);
  });

  it("rejects a worker branch that diverged from the current Goal branch", async () => {
    const { proof, worker, targetWorktreePath } = await setupPlan(["product"], ["product"], true);
    const goalWorktreePath = join(repositoryPath, "..", `maestro-goal-divergence-${randomUUID()}`);
    worktreePaths.push(goalWorktreePath);
    await localGitPort.createWorktree(repositoryPath, goalWorktreePath, "goal/integration");
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(goalWorktreePath, "goal-change.txt"), "goal");
    await localGitPort.commit(goalWorktreePath, "goal: diverge", "goal", "goal@example.com");
    await fs.writeFile(join(targetWorktreePath!, "worker-change.txt"), "worker");
    await localGitPort.commit(targetWorktreePath!, "worker: diverge", "worker", "worker@example.com");
    await expect(advanceWorkerIntegration(pool, localGitPort, worker.workerId, "worker: diverge", [...evidence.references], proof, headContext("product"))).rejects.toThrow();
    expect((await pool.query("SELECT count(*)::int AS count FROM integration_commits WHERE worker_id = $1", [worker.workerId])).rows[0]!.count).toBe(0);
  });

  it("rejects a worker branch with no new commit", async () => {
    const { proof, worker } = await setupPlan(["product"], ["product"], true);
    await expect(advanceWorkerIntegration(pool, localGitPort, worker.workerId, "repair: missing", [...evidence.references], proof, headContext("product"))).rejects.toThrow("no commit");
  });

  it("binds target worktree before admission and completes the real accept-to-certify lifecycle", async () => {
    const { goalId, proof, worker, kernel, targetWorktreePath } = await setupPlan(["product", "quality"], ["product"], true);
    expect(targetWorktreePath).toBeDefined();
    expect(kernel.admissions[0]?.cwd).toBe(targetWorktreePath);
    await expect(sendWorkerMessageUnderOwnerClaim(pool, kernel, worker.workerId, "repair the target defect", proof)).resolves.toBe(true);
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(targetWorktreePath!, "repair.txt"), "repair");
    const commit = await localGitPort.commit(targetWorktreePath!, "repair: apply fix", "worker", "worker@example.com");
    const integrated = await advanceWorkerIntegration(pool, localGitPort, worker.workerId, "repair: apply fix", [...evidence.references], proof, headContext("product"));
    expect(integrated.commitSha).toBe(commit.commitSha);
    expect(execFileSync("git", ["rev-parse", "goal/integration"], { cwd: repositoryPath }).toString().trim()).toBe(commit.commitSha);
    const stored = await pool.query<{ commit_sha: string }>("SELECT commit_sha FROM integration_commits WHERE worker_id = $1", [worker.workerId]);
    expect(stored.rows[0]!.commit_sha.trim()).toBe(commit.commitSha);
    const observed = await observeWorker(pool, kernel, worker.workerId, proof, headContext("product"));
    expect(observed.status).toBe("succeeded");
    const acceptance = await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "repair verified" }, proof, headContext("product"));
    expect(acceptance.commitSha).toBe(commit.commitSha);
    const revision = await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    const certification = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [...evidence.references] }, "quality", proof, headContext("quality"));
    expect(certification.integrationRevisionId).toBe(revision.revisionId);
  });

  it("rejects every Git integration write with a stale fencing token and leaves durable state unchanged", async () => {
    const { goalId, council, worker, proof } = await setupPlan();
    const forgedProof = { goalId, ownerId: proof.ownerId, fencingToken: String(BigInt(proof.fencingToken) + 1n) };
    const worktreePath = join(repositoryPath, "..", `maestro-stale-fencing-worker-${randomUUID()}`);
    worktreePaths.push(worktreePath);

    await expect(recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, forgedProof))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM goal_integration_branches WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(0);
    await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);

    await expect(recordDepartmentBranch(pool, localGitPort, council.councilId, "product", forgedProof, headContext("product")))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM department_branches WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(0);
    await recordDepartmentBranch(pool, localGitPort, council.councilId, "product", proof, headContext("product"));

    await expect(recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, forgedProof, headContext("product")))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM worker_worktrees WHERE worker_id = $1", [worker.workerId])).rows[0]!.count).toBe(0);
    const created = await recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, headContext("product"));
    expect(created.workerId).toBe(worker.workerId);
  });

  it("rejects a Department branch before the Goal integration branch exists", async () => {
    const { council, proof } = await setupPlan();
    await expect(recordDepartmentBranch(pool, localGitPort, council.councilId, "product", proof, headContext("product"))).rejects.toBeInstanceOf(GitIntegrationError);
  });

  it("rejects a worker worktree from an unauthorized actor", async () => {
    const { goalId, council, worker, proof } = await setupPlan();
    await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    await recordDepartmentBranch(pool, localGitPort, council.councilId, "product", proof, headContext("product"));
    const worktreePath = join(repositoryPath, "..", `maestro-worker-${randomUUID()}`);
    worktreePaths.push(worktreePath);
    await expect(recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, context("not-the-head"))).rejects.toBeInstanceOf(GitIntegrationError);
  });

  it("rejects a Department branch for a captured Department the Council did not assign ownership to", async () => {
    const { goalId, council, proof } = await setupPlan(["product", "engineering"], ["product"]);
    await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    await expect(recordDepartmentBranch(pool, localGitPort, council.councilId, "engineering", proof, headContext("engineering"))).rejects.toBeInstanceOf(GitIntegrationError);
    const owned = await recordDepartmentBranch(pool, localGitPort, council.councilId, "product", proof, headContext("product"));
    expect(owned.departmentId).toBe("product");
  });

  it("rejects direct tampering with append-only Git integration evidence", async () => {
    const { goalId, proof } = await setupPlan();
    await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    await expect(pool.query("UPDATE goal_integration_branches SET branch_name = 'tampered' WHERE goal_id = $1", [goalId])).rejects.toThrow();
  });

  it("reads the real durable Goal integration branch and latest frozen revision for the Secretary/CLI Git status view", async () => {
    const { goalId, council, worker, proof } = await setupPlan();
    const empty = await getGoalGitIntegrationState(pool, goalId);
    expect(empty.branch).toBeUndefined();
    expect(empty.latestRevision).toBeUndefined();

    const goalBranch = await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    await recordDepartmentBranch(pool, localGitPort, council.councilId, "product", proof, headContext("product"));
    const afterBranch = await getGoalGitIntegrationState(pool, goalId);
    expect(afterBranch.branch).toEqual(goalBranch);
    expect(afterBranch.latestRevision).toBeUndefined();

    const worktreePath = join(repositoryPath, "..", `maestro-worker-${randomUUID()}`);
    worktreePaths.push(worktreePath);
    await recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, headContext("product"));
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(worktreePath, "change.txt"), "mission-only change");
    const commitResult = await localGitPort.commit(worktreePath, "mission: add change", "worker", "worker@example.com");
    await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, commitResult.commitSha);
    await recordIntegrationCommit(pool, worker.workerId, commitResult.commitSha, "mission: add change", [...evidence.references]);
    const acceptanceId = randomUUID();
    await pool.query(
      "INSERT INTO department_acceptances (acceptance_id, worker_id, commit_sha, reason, accepted_by, session_ref, created_at) VALUES ($1, $2, $3, 'looks good', 'head:product', 'opaque:product', transaction_timestamp())",
      [acceptanceId, worker.workerId, commitResult.commitSha],
    );
    const revision = await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    const afterRevision = await getGoalGitIntegrationState(pool, goalId);
    expect(afterRevision.branch).toEqual(goalBranch);
    expect(afterRevision.latestRevision).toEqual(revision);
    expect(council.councilId).toBeDefined();
  });
});
