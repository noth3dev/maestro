import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
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
import { runEncoreCouncilReview } from "./encore-council.js";

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
    await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, commitResult.commitSha);
    await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
    await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    return { goalId, council: resolved, worker, evidenceIds, proof };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS certification_conflict_resolution_members, certification_conflict_resolutions, certification_waivers, conditional_certifications, quality_certifications, goal_integration_revision_commits, goal_integration_revisions, encore_council_syntheses, encore_council_judgments, encore_council_rounds, conditional_certifications, quality_certifications, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE certification_conflict_resolutions, certification_waivers, encore_council_syntheses, encore_council_judgments, encore_council_rounds, conditional_certifications, quality_certifications, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("grants a waiver for a noncritical finding, recording authority/reason/consequence/expiry/follow-up, and is idempotent", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit();
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [{ findingId: "f1", severity: "noncritical", description: "minor style issue" }], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    const future = new Date(Date.now() + 86_400_000);
    const waiver = await grantCertificationWaiver(pool, "quality_certifications", certified.certificationId, "f1", { authority: "ceo", reason: "not blocking", consequence: "tracked as debt", followUp: "fix next sprint", expiresAt: future }, "concertmaster", proof);
    expect(waiver.authority).toBe("ceo");
    const replay = await grantCertificationWaiver(pool, "quality_certifications", certified.certificationId, "f1", { authority: "ceo", reason: "not blocking", consequence: "tracked as debt", followUp: "fix next sprint", expiresAt: future }, "concertmaster", proof);
    expect(replay).toEqual(waiver);
  });

  it("rejects waiving a critical finding even to close the Goal", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit();
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "failed", findings: [{ findingId: "f1", severity: "critical", description: "security hole" }], testEvidenceIds: [] }, "quality", proof, headContext("quality"));
    const future = new Date(Date.now() + 86_400_000);
    await expect(grantCertificationWaiver(pool, "quality_certifications", certified.certificationId, "f1", { authority: "ceo", reason: "just close it", consequence: "none", followUp: "none", expiresAt: future }, "concertmaster", proof)).rejects.toBeInstanceOf(CertificationError);
  });

  it("rejects duplicate certification finding identities at the database boundary", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit();
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    const lineage = await pool.query<{
      goal_id: string; contract_id: string; contract_version: string; contract_content_hash: string; integrated_commit_sha: string;
      worker_id: string; department_acceptance_id: string; integration_revision_id: string; producing_department: string;
    }>(
      `SELECT goal_id, contract_id, contract_version, contract_content_hash, integrated_commit_sha,
              worker_id, department_acceptance_id, integration_revision_id, producing_department
         FROM quality_certifications WHERE certification_id = $1`,
      [certified.certificationId],
    );
    const row = lineage.rows[0]!;
    await expect(pool.query(
      `INSERT INTO quality_certifications
        (certification_id, goal_id, contract_id, contract_version, contract_content_hash,
         integrated_commit_sha, verdict, findings, test_evidence_ids, certified_by_department,
         producing_department, worker_id, department_acceptance_id, integration_revision_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7::jsonb, '[]'::jsonb, 'quality', $8, $9, $10, $11)`,
      [
        randomUUID(), row.goal_id, row.contract_id, row.contract_version, row.contract_content_hash,
        row.integrated_commit_sha, JSON.stringify([
          { findingId: "same-finding", severity: "noncritical", description: "first interpretation" },
          { findingId: "same-finding", severity: "critical", description: "actual correctness defect" },
        ]), row.producing_department, row.worker_id, row.department_acceptance_id, row.integration_revision_id,
      ],
    )).rejects.toThrow(/duplicate certification finding identity/i);
  });

  it("rejects direct tampering with an immutable waiver", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit();
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [{ findingId: "f1", severity: "noncritical", description: "minor" }], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    const waiver = await grantCertificationWaiver(pool, "quality_certifications", certified.certificationId, "f1", { authority: "ceo", reason: "ok", consequence: "tracked", followUp: "later", expiresAt: new Date(Date.now() + 86_400_000) }, "concertmaster", proof);
    await expect(pool.query("UPDATE certification_waivers SET reason = 'tampered' WHERE waiver_id = $1", [waiver.waiverId])).rejects.toThrow();
  });

  it("detects no conflict when certifications agree, detects a conflict when they disagree, and routes the conflict to Encore Council", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit();
    await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    expect(await detectCertificationConflict(pool, goalId)).toBe(false);
    await certifyConditional(pool, "security", worker.workerId, { verdict: "failed", findings: [{ findingId: "f1", severity: "critical", description: "vulnerability" }], testEvidenceIds: [] }, "security", proof, headContext("security"));
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
    const round = await runEncoreCouncilReview(pool, kernel, { goalId, question: "Quality and Security certifications disagree; how should we proceed?", criteria: [{ criterionId: "safety", description: "does this preserve safety" }], evidenceIds: [evidenceIds[0]!], reviewerCount: 1 });
    const resolution = await adjudicateCertificationConflict(pool, round, goalId, ["passed", "failed"], proof);
    expect(resolution.roundId).toBe(round.roundId);
    await expect(adjudicateCertificationConflict(pool, round, goalId, ["passed", "passed"], proof)).rejects.toBeInstanceOf(CertificationError);
  });
});
