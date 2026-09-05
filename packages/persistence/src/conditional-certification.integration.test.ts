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
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { observeWorker, spawnWorker } from "./worker.js";
import { recordDepartmentBranch, recordGoalIntegrationBranch, recordGoalIntegrationRevision, recordIntegrationCommit, recordWorkerWorktree } from "./git-integration.js";
import { acceptDepartmentWorkerOutput, CertificationError, certifyConditional, listConditionalCertifications } from "./certification.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };

function fakeKernel(): ExecutionKernelPort {
  let counter = 0;
  return {
    async spawn() { counter += 1; return { execution: `exec-${counter}` as never, invocation: `inv-${counter}` as never }; },
    async prompt() {}, async sendMessage() {},
    async observe() { return [{ invocation: "inv-1" as never, name: "worker", status: "succeeded", toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 1 }, answer: { state: "available", text: "done" } }]; },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 1 }; },
    async getInvocationStatus() { return "succeeded"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("Department acceptance and independent Quality certification with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let repositoryPath: string;
  let baseRevision: string;
  const worktreePaths: string[] = [];

  beforeEach(() => {
    repositoryPath = mkdtempSync(join(tmpdir(), "maestro-cert-"));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: repositoryPath });
    baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
  });
  afterEach(() => {
    for (const path of worktreePaths.splice(0)) rmSync(path, { recursive: true, force: true });
    rmSync(repositoryPath, { recursive: true, force: true });
  });

  async function setupWorkerWithCommit() {
    const goalId = randomUUID(), contractId = randomUUID(), projectId = randomUUID();
    const contractContent: TaskContractSubstance = {
      desiredOutcome: "deliver safely", userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [], acceptableTradeoffs: [], constraints: [], knownEdgeCases: [],
      project: { projectId, repository: repositoryPath, immutableBaseRevision: baseRevision, dataBoundary: "local" },
      evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [], environmentAssumptions: [], externalServiceAssumptions: [],
      budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
    };
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [goalId, projectId]);
    await pool.query("INSERT INTO task_contracts (contract_id, schema_version, version, content, content_hash, launch_state) VALUES ($1, 1, 1, $2::jsonb, $3, 'launched')", [contractId, JSON.stringify(contractContent), taskContractContentHash(contractContent)]);
    const evidenceIds = [randomUUID(), randomUUID()];
    for (const evidenceId of evidenceIds) {
      await pool.query(
        "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
        [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
      );
    }
    for (const departmentId of ["product", "quality", "security", "safety-compliance"]) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: evidenceIds } }, proof, context("secretary"));
    for (const departmentId of ["product", "quality", "security", "safety-compliance"]) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const packet: DecisionPacket = {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
      rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "own it" }, { departmentId: "quality", responsibility: "certify it" }],
      workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    const planSubstance: DepartmentPlanSubstance = {
      contribution: "implement", nonGoals: [],
      items: [{ itemId: "exec-1", kind: "execution", objective: "implement", dependsOn: [], scoutQuestion: "", workerAssignment: "implement", evidenceReferences: [] }],
      requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
      gitRepository: repositoryPath, gitBranch: "phase2/product", integrationPath: "packages/product",
      risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
    };
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance }, proof, headContext("product"));
    const bundleSubstance: MissionBundleSubstance = {
      role: "execution", profileRef: "profile-1", goalBrief: "implement",
      approvedModels: ["model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/product"],
      environment: ["node24"], authorityBoundary: ["write-scoped"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
      costCeiling: "5 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
      deliverable: "a change", evidenceRequirements: ["diff"], validationCriteria: ["tests pass"], terminationConditions: ["deadline passed"],
    };
    await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance }, proof, headContext("product"));
    const kernel = fakeKernel();
    const worker = await spawnWorker(pool, kernel, { councilId: resolved.councilId, departmentId: "product", planVersion: plan.version, itemId: "exec-1" }, proof, headContext("product"));
    await observeWorker(pool, kernel, worker.workerId);
    await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    await recordDepartmentBranch(pool, localGitPort, resolved.councilId, "product", proof, headContext("product"));
    const worktreePath = join(repositoryPath, "..", `maestro-cert-worker-${randomUUID()}`);
    worktreePaths.push(worktreePath);
    await recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, headContext("product"));
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(worktreePath, "change.txt"), "the change");
    const commitResult = await localGitPort.commit(worktreePath, "mission: implement", "worker", "worker@example.com");
    await recordIntegrationCommit(pool, worker.workerId, commitResult.commitSha, "mission: implement", evidenceIds);
    await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, commitResult.commitSha);
    await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, proof, headContext("product"));
    await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    return { goalId, council: resolved, worker, evidenceIds, proof };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS certification_conflict_resolution_members, certification_conflict_resolutions, certification_waivers, conditional_certifications, quality_certifications, goal_integration_revision_commits, goal_integration_revisions, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE conditional_certifications, quality_certifications, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("lets an independent Department certify Security but rejects the producing Department certifying itself", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit();
    await expect(certifyConditional(pool, "security", worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "product", proof, headContext("product"))).rejects.toBeInstanceOf(CertificationError);
    const certified = await certifyConditional(pool, "security", worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "security", proof, headContext("security"));
    expect(certified.kind).toBe("security");
    expect(certified.certifiedByDepartment).toBe("security");
    const listed = await listConditionalCertifications(pool, certified.goalId, "security");
    expect(listed).toHaveLength(1);
  });

  it("certifies Safety & Compliance independently of Security, both listed together", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit();
    await certifyConditional(pool, "security", worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "security", proof, headContext("security"));
    await certifyConditional(pool, "safety_compliance", worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "safety-compliance", proof, headContext("safety-compliance"));
    const all = await listConditionalCertifications(pool, goalId);
    expect(all).toHaveLength(2);
    expect(all.map((cert) => cert.kind).sort()).toEqual(["safety_compliance", "security"]);
  });

  it("rejects a passed certification with fabricated test evidence or an unauthorized certifier", async () => {
    const { worker, proof } = await setupWorkerWithCommit();
    await expect(certifyConditional(pool, "security", worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: ["fabricated"] }, "security", proof, headContext("security"))).rejects.toThrow();
    await expect(certifyConditional(pool, "security", worker.workerId, { verdict: "failed", findings: [], testEvidenceIds: [] }, "security", proof, context("not-the-head"))).rejects.toBeInstanceOf(CertificationError);
  });

  it("rejects direct tampering with immutable conditional certification records", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit();
    const certified = await certifyConditional(pool, "security", worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "security", proof, headContext("security"));
    await expect(pool.query("UPDATE conditional_certifications SET verdict = 'failed' WHERE certification_id = $1", [certified.certificationId])).rejects.toThrow();
  });
});
