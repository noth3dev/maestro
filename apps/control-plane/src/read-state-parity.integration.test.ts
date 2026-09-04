import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localGitPort } from "../../../test/git-port.js";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import {
  bootstrapPermanentOrganization,
  bootstrapLocalOperator,
  grantProjectMembership,
  acquireGoalLease,
  createHeadCouncil,
  recordCouncilDecisionPacket,
  revealCouncilBriefs,
  submitIndependentBrief,
  createDepartmentPlan,
  createMissionBundle,
  observeWorker,
  spawnWorker,
  recordDepartmentBranch,
  recordGoalIntegrationBranch,
  recordGoalIntegrationRevision,
  recordIntegrationCommit,
  recordWorkerWorktree,
  acceptDepartmentWorkerOutput,
  certifyQuality,
  raiseMetronomeChallenge,
  runEncoreCouncilReview,
  generateConcertmasterFinalReport,
} from "@maestro/persistence";
import { executeCli } from "../../cli/src/main.js";
import { createControlPlane } from "./main.js";
import { applyAllMigrations } from "../../../packages/persistence/src/test-migrations.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });
const metronomeContext = (label: string) => ({ actorId: "  encore-metronome  ", sessionRef: `metronome-session:${label}`, commandId: randomUUID() });
const brief: IndependentBrief = { interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [], proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [] };

function fakeWorkerKernel(): ExecutionKernelPort {
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

function fakeReviewKernel(): ExecutionKernelPort {
  let counter = 0;
  return {
    async spawn() { counter += 1; return { execution: `review-exec-${counter}` as never, invocation: `review-inv-${counter}` as never }; },
    async prompt() {}, async sendMessage() {},
    async observe(execution) {
      const index = (execution as unknown as string).replace("review-exec-", "");
      return [{ invocation: `review-inv-${index}` as never, name: "reviewer", status: "succeeded", toolEvents: { state: "empty", events: [] }, usage: { state: "available", totalTokens: 1 }, answer: { state: "available", text: "PROCEED\nconfidence: high\nreason: consistent evidence" } }];
    },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake-reviewer", id: "fake-reviewer-1" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 1 }; },
    async getInvocationStatus() { return "succeeded"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("App/API and CLI durable read-state parity (plan/phase3.md Tests item 18)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let repositoryPath: string;
  let baseRevision: string;
  const worktreePaths: string[] = [];

  beforeEach(() => {
    repositoryPath = mkdtempSync(join(tmpdir(), "maestro-parity-"));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: repositoryPath });
    baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
  });
  afterEach(() => {
    for (const path of worktreePaths.splice(0)) rmSync(path, { recursive: true, force: true });
    rmSync(repositoryPath, { recursive: true, force: true });
  });

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS concertmaster_final_reports, evidence_bundles, certification_conflict_resolution_members, certification_conflict_resolutions, certification_waivers, conditional_certifications, quality_certifications, encore_council_syntheses, encore_council_judgments, encore_council_rounds, semantic_reviews, metronome_challenge_findings, metronome_challenges, metronome_findings, goal_integration_revision_commits, goal_integration_revisions, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, budget_forecasts, budget_reservations, team_lead_grants, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, local_operator_credentials, local_operators, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE reconciler_leader_lease, concertmaster_final_reports, evidence_bundles, quality_certifications, department_acceptances, integration_commits, worker_worktrees, department_branches, goal_integration_branches, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, metronome_challenges, encore_council_rounds, local_operator_credentials, local_operators, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("shows the same Metronome challenge, Encore Council round, certification, and Concertmaster report state through the HTTP API and the CLI for the same real Goal", async () => {
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
    const kernel = fakeWorkerKernel();
    const worker = await spawnWorker(pool, kernel, { councilId: resolved.councilId, departmentId: "product", planVersion: plan.version, itemId: "exec-1" }, proof, headContext("product"));
    await observeWorker(pool, kernel, worker.workerId);
    await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
    await recordDepartmentBranch(pool, localGitPort, resolved.councilId, "product", proof, headContext("product"));
    const worktreePath = join(repositoryPath, "..", `maestro-parity-worker-${randomUUID()}`);
    worktreePaths.push(worktreePath);
    await recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, headContext("product"));
    await writeFile(join(worktreePath, "change.txt"), "the change");
    const commitResult = await localGitPort.commit(worktreePath, "mission: implement", "worker", "worker@example.com");
    await recordIntegrationCommit(pool, worker.workerId, commitResult.commitSha, "mission: implement", evidenceIds);
    await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, commitResult.commitSha);
    await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
    await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);

    // Real durable state for all four kinds Tests item 18 requires: a Metronome
    // challenge, an Encore Council round, a Quality certification, and a
    // Concertmaster final report -- all against this one real Goal.
    const challenge = await raiseMetronomeChallenge(pool, goalId, [], { reason: "verify independence before certifying", evidenceReferences: [] }, proof, metronomeContext("raise"));
    const round = await runEncoreCouncilReview(pool, fakeReviewKernel(), {
      goalId, question: "should we proceed to certification?",
      criteria: [{ criterionId: "safety", description: "preserves safety invariants" }],
      evidenceIds: [evidenceIds[0]!], reviewerCount: 1,
    });
    await certifyQuality(pool, worker.workerId, { verdict: "passed", findings: [], testEvidenceIds: [evidenceIds[0]!] }, "quality", proof, headContext("quality"));
    const report = await generateConcertmasterFinalReport(pool, goalId);

    const secret = "read-state-parity-test-secret";
    const { credentialId, operatorId } = await bootstrapLocalOperator(pool, { secret });
    await grantProjectMembership(pool, operatorId, projectId);
    const bearerToken = `${credentialId}.${secret}`;
    const controlPlane = createControlPlane({
      databaseUrl: databaseUrl!, evidenceDir: "/tmp/maestro-evidence", host: "127.0.0.1", port: 0,
      primeAgentVersion: "0.8.0", actorId: "maestro-control-plane", leaseOwnerId: `read-state-parity-${randomUUID()}`,
      reconcilerLeaseDurationMs: 30_000,
    });
    await controlPlane.listen();
    const address = controlPlane.app.server.address();
    if (address === null || typeof address === "string") throw new Error("Expected TCP listener");
    const apiUrl = `http://127.0.0.1:${address.port}`;
    const env = { MAESTRO_API_URL: apiUrl, MAESTRO_API_TOKEN: bearerToken };
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = { stdout: (line: string) => { stdout.push(line); }, stderr: (line: string) => { stderr.push(line); } };

    try {
      expect(await executeCli(["metronome-challenges", "list", "--goal-id", goalId, "--json"], env, io)).toBe(0);
      const cliChallenges = JSON.parse(stdout.at(-1)!) as { challenges: { challengeId: string; status: string }[] };
      expect(cliChallenges.challenges).toHaveLength(1);
      expect(cliChallenges.challenges[0]!.challengeId).toBe(challenge.challengeId);
      expect(cliChallenges.challenges[0]!.status).toBe(challenge.status);

      expect(await executeCli(["encore-council", "list", "--goal-id", goalId, "--json"], env, io)).toBe(0);
      const cliRounds = JSON.parse(stdout.at(-1)!) as { rounds: { roundId: string; synthesis: { finalVerdict: string } }[] };
      expect(cliRounds.rounds).toHaveLength(1);
      expect(cliRounds.rounds[0]!.roundId).toBe(round.roundId);
      expect(cliRounds.rounds[0]!.synthesis.finalVerdict).toBe(round.synthesis.finalVerdict);

      expect(await executeCli(["certifications", "list", "--goal-id", goalId, "--json"], env, io)).toBe(0);
      const cliCertifications = JSON.parse(stdout.at(-1)!) as { certifications: { kind: string; verdict: string }[] };
      expect(cliCertifications.certifications).toHaveLength(1);
      expect(cliCertifications.certifications[0]!.kind).toBe("quality");
      expect(cliCertifications.certifications[0]!.verdict).toBe("passed");

      expect(await executeCli(["concertmaster-report", "get", "--goal-id", goalId, "--json"], env, io)).toBe(0);
      const cliReport = JSON.parse(stdout.at(-1)!) as { reportId: string; success: boolean };
      expect(cliReport.reportId).toBe(report.reportId);
      expect(cliReport.success).toBe(report.success);

      // Prove the api-client (the same client the CLI itself uses) sees
      // identical facts through the real HTTP surface, not merely that the
      // CLI's own formatting happens to match.
      const { createApiClient } = await import("@maestro/api-client");
      const client = createApiClient({ baseUrl: apiUrl, token: bearerToken });
      const apiChallenges = await client.listMetronomeChallenges(goalId);
      const apiRounds = await client.listEncoreCouncilRounds(goalId);
      const apiCertifications = await client.listCertifications(goalId);
      const apiReport = await client.getConcertmasterReport(goalId);

      expect(apiChallenges).toEqual(cliChallenges);
      expect(apiRounds).toEqual(cliRounds);
      expect(apiCertifications).toEqual(cliCertifications);
      expect(apiReport).toEqual(cliReport);

      expect(stderr).toEqual([]);
    } finally {
      await controlPlane.close();
    }
  });
});
