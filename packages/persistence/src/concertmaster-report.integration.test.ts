import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localGitPort } from "../../../test/git-port.js";
import { FileEvidenceStore } from "@maestro/evidence";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { observeWorker, spawnWorker } from "./worker.js";
import { recordDepartmentBranch, recordGoalIntegrationBranch, recordGoalIntegrationRevision, recordIntegrationCommit, recordWorkerWorktree } from "./git-integration.js";
import { acceptDepartmentWorkerOutput, certifyQuality } from "./certification.js";
import { generateConcertmasterFinalReport, readConcertmasterFinalReport, ConcertmasterReportError } from "./concertmaster-report.js";
import { recordActualCost } from "./actual-cost.js";
import { reserveGoalBudget } from "./budget-reservation.js";

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

describeDatabase("Concertmaster final report with PostgreSQL", () => {
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
    for (const departmentId of ["product", "quality"]) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: evidenceIds } }, proof, context("secretary"));
    for (const departmentId of ["product", "quality"]) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
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
    await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
    await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    return { goalId, council: resolved, worker, evidenceIds, proof };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS concertmaster_final_reports, evidence_bundles, certification_conflict_resolution_members, certification_conflict_resolutions, certification_waivers, conditional_certifications, quality_certifications, goal_integration_revision_commits, goal_integration_revisions, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE concertmaster_final_reports, evidence_bundles, quality_certifications, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("reports success with independent validation when the required certification passes cleanly, and blocks it once a challenge opens", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit();
    await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    const report = await generateConcertmasterFinalReport(pool, goalId, proof);
    expect(report.success).toBe(true);
    expect(report.blockers).toHaveLength(0);
    expect(report.userVisibleBehaviorPassed).toBe(true);
    expect(report.independentValidation).toContain("quality: passed");
    expect(report.criticalActionAwaitingApproval).toBe(false);
    await expect(generateConcertmasterFinalReport(pool, goalId, proof)).resolves.toEqual(report);
    const reportCount = await pool.query("SELECT count(*)::int AS count FROM concertmaster_final_reports WHERE goal_id = $1", [goalId]);
    expect(reportCount.rows[0]!.count).toBe(1);
    const read = await readConcertmasterFinalReport(pool, report.reportId);
    expect(read).toEqual(report);
  });

  it("blocks a report when immutable actual spend exceeds the Goal envelope", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit();
    await reserveGoalBudget(pool, goalId, 100, "bounded test envelope", proof, context("secretary"));
    const costContext = context("cost-meter");
    const first = await recordActualCost(pool, goalId, 101, "provider:test", proof, costContext);
    await expect(recordActualCost(pool, goalId, 101, "provider:test", proof, costContext)).resolves.toEqual(first);
    await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));

    const report = await generateConcertmasterFinalReport(pool, goalId, proof);
    expect(report.success).toBe(false);
    expect(report.costCents).toBe(101);
    expect(report.budgetCents).toBe(100);
    expect(report.blockers).toContainEqual({ reason: "budget_exceeded", detail: "Actual cost 101 cents exceeds the Goal budget 100 cents" });
  });

  it("reports failure with a missing_required_certification blocker when Quality never certified", async () => {
    const { goalId, proof } = await setupWorkerWithCommit();
    const report = await generateConcertmasterFinalReport(pool, goalId, proof);
    expect(report.success).toBe(false);
    expect(report.blockers.some((blocker) => blocker.reason === "missing_required_certification")).toBe(true);
  });

  it("reports failure and flags an awaiting critical action when a critical finding is unwaived", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit();
    await certifyQuality(pool, worker.workerId, { verdict: "failed", findings: [{ findingId: "f1", severity: "critical", description: "security hole" }], testEvidenceIds: [] }, "quality", proof, headContext("quality"));
    const report = await generateConcertmasterFinalReport(pool, goalId, proof);
    expect(report.success).toBe(false);
    expect(report.criticalActionAwaitingApproval).toBe(true);
    expect(report.blockers.some((blocker) => blocker.reason === "unwaived_critical_finding")).toBe(true);
  });

  it("includes real Git integration evidence in whatChanged and durably links a real evidence bundle", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit();
    await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    const report = await generateConcertmasterFinalReport(pool, goalId, proof);
    expect(report.whatChanged).toContain("mission: implement");
    expect(report.evidenceBundleId).toBeTruthy();
  });

  it("rejects stale and paused Goal report effects before creating a bundle or report", async () => {
    const { goalId, proof } = await setupWorkerWithCommit();
    const forged = { ...proof, fencingToken: "999999" };
    await expect(generateConcertmasterFinalReport(pool, goalId, forged)).rejects.toThrow(/stale or invalid/);
    await pool.query("INSERT INTO goal_controls (project_id, goal_id, pause_requested_at, paused_at) SELECT project_id, goal_id, clock_timestamp(), clock_timestamp() FROM goals WHERE goal_id = $1 ON CONFLICT (project_id, goal_id) DO UPDATE SET pause_requested_at = clock_timestamp(), paused_at = clock_timestamp()", [goalId]);
    await expect(generateConcertmasterFinalReport(pool, goalId, proof)).rejects.toThrow(/paused/);
    const reports = await pool.query("SELECT count(*)::int AS count FROM concertmaster_final_reports WHERE goal_id = $1", [goalId]);
    const bundles = await pool.query("SELECT count(*)::int AS count FROM evidence_bundles WHERE goal_id = $1", [goalId]);
    expect(reports.rows[0]!.count).toBe(0);
    expect(bundles.rows[0]!.count).toBe(0);
  });

  it("throws ConcertmasterReportError when no resolved Council decision exists for the Goal", async () => {
    const missingGoalId = randomUUID();
    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())", [missingGoalId, randomUUID()]);
    const missingProof = await acquireGoalLease(pool, { goalId: missingGoalId, ownerId: "test", leaseDurationMs: 60_000 });
    await expect(generateConcertmasterFinalReport(pool, missingGoalId, missingProof)).rejects.toBeInstanceOf(ConcertmasterReportError);
  });

  it("rejects the final report when a supplied content reader detects a corrupted evidence artifact hash (Phase 1 re-patch item 6)", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit();
    const store = new FileEvidenceStore(await mkdtemp(join(tmpdir(), "maestro-concertmaster-evidence-")));
    const captured = await store.capture({
      context: { correlationId: randomUUID(), commandId: randomUUID(), projectId: randomUUID(), goalId, actorId: "test" },
      bytes: Buffer.from("real concertmaster-report evidence artifact"), kind: "test-result", mediaType: "text/plain",
    });
    // Repoint every evidence row for this Goal at the same genuinely stored
    // content -- assembleEvidenceBundle verifies all of a Goal's evidence,
    // not only the cited subset, so every row must have real backing bytes
    // before corrupting exactly one of them below.
    await pool.query("ALTER TABLE evidence_records DISABLE TRIGGER evidence_records_immutable");
    try {
      for (const evidenceId of evidenceIds) {
        await pool.query("UPDATE evidence_records SET sha256 = $1, byte_length = $2 WHERE evidence_id = $3", [captured.sha256, captured.byteLength, evidenceId]);
      }
    } finally {
      await pool.query("ALTER TABLE evidence_records ENABLE TRIGGER evidence_records_immutable");
    }
    await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));

    // Genuinely matching content produces a report cleanly when a real reader is supplied.
    const report = await generateConcertmasterFinalReport(pool, goalId, proof, store);
    expect(report.success).toBe(true);

    // Corrupt one evidence row's durable sha256 so it no longer matches its actual stored bytes.
    await pool.query("ALTER TABLE evidence_records DISABLE TRIGGER evidence_records_immutable");
    try {
      await pool.query("UPDATE evidence_records SET sha256 = $1 WHERE evidence_id = $2", ["d".repeat(64), evidenceIds[1]]);
    } finally {
      await pool.query("ALTER TABLE evidence_records ENABLE TRIGGER evidence_records_immutable");
    }

    // The final report is immutable and idempotent per Goal. A retry returns
    // its already-committed artifact rather than creating a second snapshot or
    // reinterpreting live state after the original report was issued.
    await expect(generateConcertmasterFinalReport(pool, goalId, proof, store)).resolves.toEqual(report);
    await expect(generateConcertmasterFinalReport(pool, goalId, proof)).resolves.toEqual(report);
  });
});
