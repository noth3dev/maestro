import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localGitPort } from "@maestro/git-adapter";
import { EvidenceIntegrityError, FileEvidenceStore } from "@maestro/evidence";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { observeWorker, spawnWorker } from "./worker.js";
import { recordDepartmentBranch, recordGoalIntegrationBranch, recordGoalIntegrationRevision, recordIntegrationCommit, recordWorkerWorktree } from "./git-integration.js";
import { acceptDepartmentWorkerOutput, CertificationError, certifyQuality, listQualityCertifications } from "./certification.js";
import { StaleGoalLeaseError, type GoalLeaseProof } from "./commands.js";
import { CouncilProtocolError } from "./council.js";

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

  async function setupWorkerWithCommit(prepareCertification = false) {
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
    if (prepareCertification) {
      await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, commitResult.commitSha);
      await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
      await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    }
    return { goalId, council: resolved, worker, evidenceIds, proof };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS certification_conflict_resolution_members, certification_conflict_resolutions, certification_waivers, conditional_certifications, quality_certifications, goal_integration_revision_commits, goal_integration_revisions, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE quality_certifications, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("lets the Executing Head accept its own worker output", async () => {
    const { worker } = await setupWorkerWithCommit();
    const accepted = await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
    expect(accepted.workerId).toBe(worker.workerId);
    const replay = await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
    expect(replay).toEqual(accepted);
  });

  // Phase 2 re-patch item 6: acceptDepartmentWorkerOutput was an unguarded
  // check-then-insert race, saved only by the DB's UNIQUE (worker_id)
  // constraint whose violation surfaced as a raw Postgres error instead of
  // this codebase's usual idempotent-return pattern. Two genuinely concurrent
  // callers for the same worker_id must both resolve successfully to the same
  // logical (durable) row -- no raw DB error, no thrown unique-violation.
  it("resolves two concurrent acceptDepartmentWorkerOutput calls for the same worker to the same durable row with no raw DB error", async () => {
    const { worker } = await setupWorkerWithCommit();
    const [first, second] = await Promise.all([
      acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product")),
      acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product")),
    ]);
    expect(first).toEqual(second);
    const rows = await pool.query("SELECT acceptance_id FROM department_acceptances WHERE worker_id = $1", [worker.workerId]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.acceptance_id).toBe(first.acceptanceId);
  });

  it("lets an independent Department certify Quality but rejects the producing Department certifying itself", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit(true);
    await expect(certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "product", proof, headContext("product"))).rejects.toBeInstanceOf(CertificationError);
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    expect(certified.certifiedByDepartment).toBe("quality");
    expect(certified.producingDepartment).toBe("product");
    const listed = await listQualityCertifications(pool, certified.goalId);
    expect(listed).toHaveLength(1);
  });

  it("rejects certification when a supplied content reader detects a cited evidence artifact's real bytes no longer match its durable metadata (Phase 1 re-patch item 6)", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit(true);
    const store = new FileEvidenceStore(await mkdtemp(join(tmpdir(), "maestro-cert-evidence-")));
    const captured = await store.capture({
      context: { correlationId: randomUUID(), commandId: randomUUID(), projectId: randomUUID(), goalId: randomUUID(), actorId: "test" },
      bytes: Buffer.from("real quality evidence artifact"), kind: "test-result", mediaType: "text/plain",
    });
    // Repoint this test's citation at genuinely stored, real bytes -- not
    // the setup helper's placeholder sha256/byte_length=0 row.
    await pool.query("ALTER TABLE evidence_records DISABLE TRIGGER evidence_records_immutable");
    try {
      await pool.query("UPDATE evidence_records SET sha256 = $1, byte_length = $2 WHERE evidence_id = $3", [captured.sha256, captured.byteLength, evidenceIds[0]]);
    } finally {
      await pool.query("ALTER TABLE evidence_records ENABLE TRIGGER evidence_records_immutable");
    }

    // With genuinely matching content, certification succeeds when a real reader is supplied.
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"), store);
    expect(certified.certifiedByDepartment).toBe("quality");
    const beforeCorruptionCount = (await listQualityCertifications(pool, certified.goalId)).length;

    // Now corrupt the durable metadata's sha256 (a different, still well-formed hash) so it no
    // longer matches the actual stored artifact -- the exact "corrupted evidence hash" scenario.
    await pool.query("ALTER TABLE evidence_records DISABLE TRIGGER evidence_records_immutable");
    try {
      await pool.query("UPDATE evidence_records SET sha256 = $1 WHERE evidence_id = $2", ["b".repeat(64), evidenceIds[1]]);
    } finally {
      await pool.query("ALTER TABLE evidence_records ENABLE TRIGGER evidence_records_immutable");
    }

    await expect(
      certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[1]!] }, "quality", proof, headContext("quality"), store),
    ).rejects.toBeInstanceOf(CertificationError);
    // No new certification row was written by the rejected attempt.
    expect((await listQualityCertifications(pool, certified.goalId)).length).toBe(beforeCorruptionCount);

    // Without a content reader, existing metadata-only-trust behavior is unchanged (documented,
    // not silently strengthened for callers that do not yet supply one).
    await expect(
      certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[1]!] }, "quality", proof, headContext("quality")),
    ).resolves.toBeDefined();
  });

  it("binds the certification to the exact Task Contract identity and integrated commit", async () => {
    const { worker, evidenceIds, council, proof } = await setupWorkerWithCommit(true);
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    expect(certified.contractId).toBe(council.contractId);
    expect(certified.integratedCommitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("certifies an accepted worker when the frozen revision head advances beyond its commit", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit();
    const workerCommit = (await pool.query<{ commit_sha: string }>("SELECT commit_sha FROM integration_commits WHERE worker_id = $1", [worker.workerId])).rows[0]!.commit_sha.trim();
    await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, workerCommit);
    await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
    const integrationWorktree = join(repositoryPath, "..", `maestro-cert-integration-${randomUUID()}`);
    worktreePaths.push(integrationWorktree);
    await localGitPort.createWorktree(repositoryPath, integrationWorktree, "goal/integration");
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(integrationWorktree, "integration-summary.txt"), "reviewed integration");
    const revisionHead = (await localGitPort.commit(integrationWorktree, "mission: record integration", "head", "head@example.com")).commitSha;
    const revision = await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
    expect(revision.commitSha).toBe(revisionHead);
    expect(revision.commitSha).not.toBe(workerCommit);
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    expect(certified.integratedCommitSha).toBe(revisionHead);
  });

  it("rejects a passed certification with fabricated test evidence or an unauthorized certifier", async () => {
    const { worker, proof } = await setupWorkerWithCommit(true);
    await expect(certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: ["fabricated"] }, "quality", proof, headContext("quality"))).rejects.toThrow();
    await expect(certifyQuality(pool, worker.workerId, { verdict: "failed", findings: [], testEvidenceIds: [] }, "quality", proof, context("not-the-head"))).rejects.toBeInstanceOf(CertificationError);
  });

  it("rejects direct tampering with immutable certification records", async () => {
    const { worker, evidenceIds, proof } = await setupWorkerWithCommit(true);
    const certified = await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    await expect(pool.query("UPDATE quality_certifications SET verdict = 'failed' WHERE certification_id = $1", [certified.certificationId])).rejects.toThrow();
  });

  // Phase 3 re-patch item 1 (certification.ts portion): certifyQuality previously
  // performed zero goal_lease/fencing check and zero control-latch (pause/stop/
  // emergency-stop) check. These three regressions prove the fix: a stale/forged
  // lease is rejected, a paused/stopped/emergency-stopped Goal is rejected, and a
  // genuine current lease on an open Goal still succeeds (the last case is already
  // covered by every other test above, which all pass their real `proof`).
  it("rejects certifyQuality with a stale/forged lease fencing token", async () => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit(true);
    const forged: GoalLeaseProof = { ...proof, fencingToken: String(BigInt(proof.fencingToken) + 1n) };
    await expect(
      certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", forged, headContext("quality")),
    ).rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect(await listQualityCertifications(pool, goalId)).toEqual([]);
  });

  it.each([
    ["paused", "INSERT INTO goal_controls (project_id, goal_id, pause_requested_at, paused_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp()) ON CONFLICT (project_id, goal_id) DO UPDATE SET pause_requested_at = clock_timestamp(), paused_at = clock_timestamp()"],
    ["stopping", "INSERT INTO goal_controls (project_id, goal_id, stopping_at) VALUES ($1, $2, clock_timestamp()) ON CONFLICT (project_id, goal_id) DO UPDATE SET stopping_at = clock_timestamp()"],
    ["stopped", "INSERT INTO goal_controls (project_id, goal_id, stopping_at, stopped_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp()) ON CONFLICT (project_id, goal_id) DO UPDATE SET stopping_at = clock_timestamp(), stopped_at = clock_timestamp()"],
    ["emergency-stopped", "INSERT INTO goal_controls (project_id, goal_id, emergency_stopped_at) VALUES ($1, $2, clock_timestamp()) ON CONFLICT (project_id, goal_id) DO UPDATE SET emergency_stopped_at = clock_timestamp()"],
  ])("rejects certifyQuality once the Goal is %s", async (_label, insertSql) => {
    const { goalId, worker, evidenceIds, proof } = await setupWorkerWithCommit(true);
    const projectId = (await pool.query<{ project_id: string }>("SELECT project_id FROM goals WHERE goal_id = $1", [goalId])).rows[0]!.project_id;
    await pool.query(insertSql, [projectId, goalId]);
    await expect(
      certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality")),
    ).rejects.toBeInstanceOf(CouncilProtocolError);
    expect(await listQualityCertifications(pool, goalId)).toEqual([]);
  });
});
