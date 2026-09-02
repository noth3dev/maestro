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
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { observeWorker, spawnWorker } from "./worker.js";
import { recordDepartmentBranch, recordGoalIntegrationBranch, recordGoalIntegrationRevision, recordIntegrationCommit, recordWorkerWorktree } from "./git-integration.js";
import { acceptDepartmentWorkerOutput, adjudicateCertificationConflict, CertificationError, certifyConditional, certifyQuality, detectCertificationConflict, grantCertificationWaiver } from "./certification.js";
import { runOverwatchCouncilReview } from "./overwatch-council.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0014_head_activation_runtime_safety.sql", "0015_council_protocol.sql", "0016_council_hardening.sql", "0018_role_identity_hardening.sql", "0019_council_authority_hardening.sql", "0020_head_role_identity_hardening.sql", "0021_council_round_idempotency.sql", "0022_department_plans.sql", "0023_mission_bundles.sql", "0024_workers.sql", "0026_git_integration.sql", "0031_overwatch_council.sql", "0032_certifications.sql", "0033_conditional_certifications.sql", "0034_certification_waivers.sql", "0035_evidence_bundles.sql", "0036_sane_final_reports.sql", "0037_certification_report_hardening.sql"];

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
    for (const departmentId of ["product", "quality", "security"]) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: evidenceIds } }, proof, context("secretary"));
    for (const departmentId of ["product", "quality", "security"]) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
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
    execFileSync("git", ["branch", "--force", "goal/integration", commitResult.commitSha], { cwd: repositoryPath });
    await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
    await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    return { goalId, council: resolved, worker, evidenceIds };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS certification_conflict_resolution_members, certification_conflict_resolutions, certification_waivers, conditional_certifications, quality_certifications, goal_integration_revision_commits, goal_integration_revisions, overwatch_council_syntheses, overwatch_council_judgments, overwatch_council_rounds, conditional_certifications, quality_certifications, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE certification_conflict_resolutions, certification_waivers, overwatch_council_syntheses, overwatch_council_judgments, overwatch_council_rounds, conditional_certifications, quality_certifications, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("grants a waiver for a noncritical finding, recording authority/reason/consequence/expiry/follow-up, and is idempotent", async () => {
    const { worker, evidenceIds } = await setupWorkerWithCommit();
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [{ findingId: "f1", severity: "noncritical", description: "minor style issue" }], testEvidenceIds: [evidenceIds[0]!] }, "quality", headContext("quality"));
    const future = new Date(Date.now() + 86_400_000);
    const waiver = await grantCertificationWaiver(pool, "quality_certifications", certified.certificationId, "f1", { authority: "ceo", reason: "not blocking", consequence: "tracked as debt", followUp: "fix next sprint", expiresAt: future }, "sane");
    expect(waiver.authority).toBe("ceo");
    const replay = await grantCertificationWaiver(pool, "quality_certifications", certified.certificationId, "f1", { authority: "ceo", reason: "not blocking", consequence: "tracked as debt", followUp: "fix next sprint", expiresAt: future }, "sane");
    expect(replay).toEqual(waiver);
  });

  it("rejects waiving a critical finding even to close the Goal", async () => {
    const { worker, evidenceIds } = await setupWorkerWithCommit();
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "failed", findings: [{ findingId: "f1", severity: "critical", description: "security hole" }], testEvidenceIds: [] }, "quality", headContext("quality"));
    const future = new Date(Date.now() + 86_400_000);
    await expect(grantCertificationWaiver(pool, "quality_certifications", certified.certificationId, "f1", { authority: "ceo", reason: "just close it", consequence: "none", followUp: "none", expiresAt: future }, "sane")).rejects.toBeInstanceOf(CertificationError);
  });

  it("rejects direct tampering with an immutable waiver", async () => {
    const { worker, evidenceIds } = await setupWorkerWithCommit();
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [{ findingId: "f1", severity: "noncritical", description: "minor" }], testEvidenceIds: [evidenceIds[0]!] }, "quality", headContext("quality"));
    const waiver = await grantCertificationWaiver(pool, "quality_certifications", certified.certificationId, "f1", { authority: "ceo", reason: "ok", consequence: "tracked", followUp: "later", expiresAt: new Date(Date.now() + 86_400_000) }, "sane");
    await expect(pool.query("UPDATE certification_waivers SET reason = 'tampered' WHERE waiver_id = $1", [waiver.waiverId])).rejects.toThrow();
  });

  it("detects no conflict when certifications agree, detects a conflict when they disagree, and routes the conflict to Overwatch Council", async () => {
    const { goalId, worker, evidenceIds } = await setupWorkerWithCommit();
    await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", headContext("quality"));
    expect(await detectCertificationConflict(pool, goalId)).toBe(false);
    await certifyConditional(pool, "security", worker.workerId, { verdict: "failed", findings: [{ findingId: "f1", severity: "critical", description: "vulnerability" }], testEvidenceIds: [] }, "security", headContext("security"));
    expect(await detectCertificationConflict(pool, goalId)).toBe(true);

    const kernel: ExecutionKernelPort = {
      async spawn() { return { execution: "exec-1" as never, invocation: "inv-1" as never }; },
      async prompt() {}, async sendMessage() {},
      async observe() { return [{ invocation: "inv-1" as never, name: "reviewer", status: "succeeded", toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 1 }, answer: { state: "available", text: JSON.stringify({ verdict: "escalate", confidence: "high", reasoning: "certifications disagree", conditions: [], dissentNote: null, citedEvidenceIds: [evidenceIds[0]] }) } }]; },
      async cancel() { return { cancelled: true }; },
      async getModelIdentity() { return { provider: "fake", id: "fake" }; },
      async getToolEvents() { return { state: "empty", events: [] }; },
      async getUsage() { return { state: "available", totalTokens: 1 }; },
      async getInvocationStatus() { return "succeeded"; },
      async resume() { throw new Error("not supported"); },
      async reconnect() { throw new Error("not supported"); },
    };
    const round = await runOverwatchCouncilReview(pool, kernel, { goalId, question: "Quality and Security certifications disagree; how should we proceed?", criteria: [{ criterionId: "safety", description: "does this preserve safety" }], evidenceIds: [evidenceIds[0]!], reviewerCount: 1 });
    const resolution = await adjudicateCertificationConflict(pool, round, goalId, ["passed", "failed"]);
    expect(resolution.roundId).toBe(round.roundId);
    await expect(adjudicateCertificationConflict(pool, round, goalId, ["passed", "passed"])).rejects.toBeInstanceOf(CertificationError);
  });
});
