import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as gitAdapter from "@maestro/git-adapter";
import { localGitPort } from "../../../test/git-port.js";
import { type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { createDurableTaskContract, launchConfirmedTaskContract, recordExactTaskContractConfirmation } from "./task-contract.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { observeWorker, spawnWorker } from "./worker.js";
import { recordDepartmentBranch, recordGoalIntegrationBranch, recordGoalIntegrationRevision, recordIntegrationCommit, recordWorkerWorktree } from "./git-integration.js";
import { acceptDepartmentWorkerOutput, certifyQuality, CertificationError } from "./certification.js";
import { raiseMetronomeChallenge, MetronomeChallengeError } from "./metronome-challenge.js";
import { requestSemanticReview } from "./semantic-review.js";
import { runEncoreCouncilReview } from "./encore-council.js";
import { generateConcertmasterFinalReport } from "./concertmaster-report.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const tables = [
  "concertmaster_final_reports", "evidence_bundles", "certification_conflict_resolutions", "certification_waivers", "conditional_certifications",
  "quality_certifications", "certification_conflict_resolution_members", "department_acceptances", "goal_integration_revision_commits", "goal_integration_revisions", "encore_council_syntheses", "encore_council_judgments", "encore_council_rounds",
  "semantic_reviews", "metronome_challenge_findings", "metronome_challenges", "metronome_findings", "budget_forecasts", "budget_reservations",
  "integration_commits", "worker_worktrees", "goal_integration_branches", "team_lead_grants", "workers", "mission_bundles",
  "department_plan_revisions", "department_plans", "council_protocol_events", "council_round_contributions", "council_rounds", "independent_briefs",
  "council_participants", "head_councils", "goal_head_participations", "task_contract_confirmations", "task_contract_decisions", "task_contracts",
  "permanent_head_roles", "role_persona_axes", "permanent_roles", "departments", "organization_groups", "reconciler_leader_lease", "goal_controls",
  "authority_decisions", "authority_records", "local_operator_credentials", "local_operators", "goal_leases", "outbox", "goal_events",
  "command_receipts", "goals", "head_activation_edges", "head_activation_attempts",
];

const context = (label: string) => ({ actorId: `actor:${label}`, sessionRef: `session:${label}`, commandId: randomUUID() });
const headContext = (departmentId: string) => ({ actorId: `head:${departmentId}`, sessionRef: `opaque:${departmentId}`, commandId: randomUUID() });
const metronomeContext = () => ({ actorId: "encore-metronome", sessionRef: `metronome-session:${randomUUID()}`, commandId: randomUUID() });
const brief: IndependentBrief = {
  interpretation: "safe outcome", contribution: "review", nonGoals: [], assumptions: [], evidenceGaps: [], risks: [], dependencies: [],
  proposedValidation: [], expectedWorkers: [], expectedCost: "1", expectedTime: "1", objectionsToLikelyAlternatives: [],
};
const criteria = [{ criterionId: "safety", description: "preserve the safety invariants" }];

type KernelAnswer = { provider: string; id: string; text: string };

/** Deterministic model boundary; all state under test remains real PostgreSQL and real Git. */
function kernelWithAnswers(answers: readonly KernelAnswer[]): ExecutionKernelPort {
  let counter = 0;
  const invocations = new Map<string, KernelAnswer & { invocation: string }>();
  return {
    async spawn() {
      const index = counter;
      counter += 1;
      const answer = answers[index];
      if (answer === undefined) throw new Error(`No deterministic answer for invocation ${index}`);
      const execution = `exec-${index}`;
      const invocation = `inv-${index}`;
      invocations.set(execution, { ...answer, invocation });
      return { execution: execution as never, invocation: invocation as never };
    },
    async prompt() {},
    async sendMessage() {},
    async observe(execution) {
      const answer = invocations.get(execution as unknown as string);
      if (answer === undefined) return [];
      return [{
        invocation: answer.invocation as never,
        name: "deterministic-reviewer",
        status: "succeeded" as const,
        toolEvents: { state: "empty" as const, events: [] },
        usage: { state: "available" as const, totalTokens: 1 },
        answer: { state: "available" as const, text: answer.text },
      }];
    },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity(execution) {
      const answer = invocations.get(execution as unknown as string);
      if (answer === undefined) throw new Error("Unknown deterministic execution");
      return { provider: answer.provider, id: answer.id };
    },
    async getToolEvents() { return { state: "empty" as const, events: [] }; },
    async getUsage() { return { state: "available" as const, totalTokens: 1 }; },
    async getInvocationStatus() { return "succeeded" as const; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

async function insertGoalWithEvidence(pool: Pool, evidenceCount = 1): Promise<{ goalId: string; projectId: string; evidenceIds: string[] }> {
  const goalId = randomUUID();
  const projectId = randomUUID();
  await pool.query(
    "INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())",
    [goalId, projectId],
  );
  const evidenceIds = Array.from({ length: evidenceCount }, () => randomUUID());
  for (const evidenceId of evidenceIds) {
    await pool.query(
      "INSERT INTO evidence_records (evidence_id, correlation_id, command_id, project_id, goal_id, actor_id, sha256, byte_length, kind, media_type, retention) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'test-result', 'text/plain', 'project_lifetime')",
      [evidenceId, randomUUID(), randomUUID(), projectId, goalId, "test", "0".repeat(64)],
    );
  }
  return { goalId, projectId, evidenceIds };
}

async function setupWorkerWithRealCommit(pool: Pool, repositoryPath: string, baseRevision: string, worktreePaths: string[]) {
  const contractId = randomUUID();
  const { goalId, projectId, evidenceIds } = await insertGoalWithEvidence(pool, 2);
  const contractContent: TaskContractSubstance = {
    desiredOutcome: "deliver safely", userVisibleBehavior: [], successCriteria: [], liveEvidence: [], scope: [], nonGoals: [], priorities: [],
    acceptableTradeoffs: [], constraints: [], knownEdgeCases: [], project: { projectId, repository: repositoryPath, immutableBaseRevision: baseRevision, dataBoundary: "local" },
    evidenceReferences: [], approvedPreviewReferences: [], expectedGroups: [], expectedDepartments: [], criticalActionExpectations: [], forbiddenEffects: [],
    environmentAssumptions: [], externalServiceAssumptions: [], budget: { ceiling: "1", reportingExpectations: [], stoppingConditions: [] },
  };
  const contract = await createDurableTaskContract(pool, contractId, contractContent);
  await recordExactTaskContractConfirmation(pool, contractId, contract.version, contract.contentHash, "ceo");
  await launchConfirmedTaskContract(pool, contractId);
  for (const departmentId of ["product", "quality"]) {
    await pool.query(
      "INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)",
      [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`],
    );
  }
  const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
  const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence: { references: evidenceIds } }, proof, context("secretary"));
  for (const departmentId of ["product", "quality"]) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
  await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
  const packet: DecisionPacket = {
    outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
    rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "produce the change" }, { departmentId: "quality", responsibility: "certify the change" }],
    workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [], criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
  };
  const resolvedCouncil = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
  const planSubstance: DepartmentPlanSubstance = {
    contribution: "implement", nonGoals: [],
    items: [{ itemId: "exec-1", kind: "execution", objective: "implement", dependsOn: [], scoutQuestion: "", workerAssignment: "implement", evidenceReferences: [] }],
    requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
    gitRepository: repositoryPath, gitBranch: "phase3/product", integrationPath: "packages/product", risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
  };
  const plan = await createDepartmentPlan(pool, { councilId: resolvedCouncil.councilId, departmentId: "product", substance: planSubstance }, proof, headContext("product"));
  const bundleSubstance: MissionBundleSubstance = {
    role: "execution", profileRef: "profile-1", goalBrief: "implement", approvedModels: ["model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/product"],
    environment: ["node24"], authorityBoundary: ["write-scoped"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"], costCeiling: "5 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
    deliverable: "a change", evidenceRequirements: ["diff"], validationCriteria: ["tests pass"], terminationConditions: ["deadline passed"],
  };
  await createMissionBundle(pool, { councilId: resolvedCouncil.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance }, proof, headContext("product"));
  const workerKernel = kernelWithAnswers([{ provider: "worker-provider", id: "worker-model", text: "worker output" }]);
  const spawnedWorker = await spawnWorker(pool, workerKernel, { councilId: resolvedCouncil.councilId, departmentId: "product", planVersion: plan.version, itemId: "exec-1" }, proof, headContext("product"));
  const worker = await observeWorker(pool, workerKernel, spawnedWorker.workerId);
  await recordGoalIntegrationBranch(pool, localGitPort, goalId, repositoryPath, "goal/integration", baseRevision, proof);
  await recordDepartmentBranch(pool, localGitPort, resolvedCouncil.councilId, "product", proof, headContext("product"));
  const worktreePath = join(repositoryPath, "..", `maestro-adversarial-worker-${randomUUID()}`);
  worktreePaths.push(worktreePath);
  await recordWorkerWorktree(pool, localGitPort, worker.workerId, worktreePath, proof, headContext("product"));
  await writeFile(join(worktreePath, "seeded-defect.txt"), "worker produced a green result");
  const commitResult = await localGitPort.commit(worktreePath, "mission: seed implementation defect", "worker", "worker@example.com");
  await recordIntegrationCommit(pool, worker.workerId, commitResult.commitSha, "mission: seed implementation defect", evidenceIds);
  await localGitPort.advanceBranch(repositoryPath, "goal/integration", baseRevision, commitResult.commitSha);
  await acceptDepartmentWorkerOutput(pool, worker.workerId, { reason: "diff reviewed, tests pass" }, headContext("product"));
  await recordGoalIntegrationRevision(pool, localGitPort, goalId, proof);
  return { goalId, projectId, contractId, council: resolvedCouncil, worker, evidenceIds, commitSha: commitResult.commitSha, worktreePath, proof };
}

describeDatabase("Phase 3 adversarial fixtures with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let repositoryPath: string;
  let baseRevision: string;
  const worktreePaths: string[] = [];

  beforeAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tables.join(", ")} CASCADE`);
    await applyAllMigrations(pool);
  });
  beforeEach(async () => {
    repositoryPath = mkdtempSync(join(tmpdir(), "maestro-adversarial-"));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repositoryPath });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: repositoryPath });
    baseRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath }).toString().trim();
    await pool.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
    await bootstrapPermanentOrganization(pool);
  });
  afterEach(() => {
    for (const path of worktreePaths.splice(0)) rmSync(path, { recursive: true, force: true });
    rmSync(repositoryPath, { recursive: true, force: true });
  });
  afterAll(async () => { await pool.end(); });

  it("downgrades a model-supported semantic claim that cites only fabricated evidence", async () => {
    const { goalId } = await insertGoalWithEvidence(pool);
    const fabricatedEvidenceId = randomUUID();
    const kernel = kernelWithAnswers([{
      provider: "fake", id: "semantic-judge", text: JSON.stringify({ verdict: "supported", citedEvidenceIds: [fabricatedEvidenceId], reasoning: "trust this citation" }),
    }]);
    const review = await requestSemanticReview(pool, kernel, goalId, "the change is safe", [{ criterionId: "evidence", description: "cite durable evidence" }]);
    expect(review.verdict).toBe("unsupported");
    const recorded = await pool.query<{ verdict: string; cited_evidence_ids: string[] }>("SELECT verdict, cited_evidence_ids FROM semantic_reviews WHERE review_id = $1", [review.reviewId]);
    expect(recorded.rows[0]).toMatchObject({ verdict: "unsupported", cited_evidence_ids: [fabricatedEvidenceId] });
  });

  it("labels same-model agreement honestly and escalates disagreement while preserving dissent", async () => {
    const { goalId, evidenceIds } = await insertGoalWithEvidence(pool);
    const sameModelAnswer = JSON.stringify({ verdict: "proceed", confidence: "high", reasoning: "safe", conditions: [], dissentNote: null, citedEvidenceIds: evidenceIds });
    const sameModel = await runEncoreCouncilReview(pool, kernelWithAnswers([
      { provider: "same-provider", id: "same-model", text: sameModelAnswer },
      { provider: "same-provider", id: "same-model", text: sameModelAnswer },
    ]), { goalId, question: "should we proceed?", criteria, evidenceIds, reviewerCount: 2 });
    expect(sameModel.synthesis.sameModelOnly).toBe(true);
    expect(sameModel.synthesis.finalVerdict).toBe("proceed");
    expect(sameModel.synthesis.escalated).toBe(false);
    const sameModelRow = await pool.query<{ same_model_only: boolean; escalated: boolean }>("SELECT same_model_only, escalated FROM encore_council_syntheses WHERE round_id = $1", [sameModel.roundId]);
    expect(sameModelRow.rows[0]).toEqual({ same_model_only: true, escalated: false });

    const dissent = "The evidence does not establish safety.";
    const disagreement = await runEncoreCouncilReview(pool, kernelWithAnswers([
      { provider: "same-provider", id: "same-model", text: sameModelAnswer },
      { provider: "same-provider", id: "same-model", text: JSON.stringify({ verdict: "do_not_proceed", confidence: "high", reasoning: "unsafe", conditions: [], dissentNote: dissent, citedEvidenceIds: evidenceIds }) },
    ]), { goalId, question: "should we proceed despite the concern?", criteria, evidenceIds, reviewerCount: 2 });
    expect(disagreement.synthesis.sameModelOnly).toBe(true);
    expect(disagreement.synthesis.escalated).toBe(true);
    expect(disagreement.synthesis.finalVerdict).toBe("escalate");
    expect(disagreement.synthesis.dissentNotes).toContain(dissent);
    const disagreementRow = await pool.query<{ final_verdict: string; escalated: boolean; dissent_notes: string[] }>("SELECT final_verdict, escalated, dissent_notes FROM encore_council_syntheses WHERE round_id = $1", [disagreement.roundId]);
    expect(disagreementRow.rows[0]).toEqual({ final_verdict: "escalate", escalated: true, dissent_notes: [dissent] });
  });

  it("blocks the final report when an independent Quality Department finds a seeded critical defect", async () => {
    const { goalId, worker, evidenceIds, commitSha, proof } = await setupWorkerWithRealCommit(pool, repositoryPath, baseRevision, worktreePaths);
    expect(worker.status).toBe("succeeded");
    expect(commitSha).toMatch(/^[0-9a-f]{40}$/);
    const certification = await certifyQuality(
      pool,
      worker.workerId,
      { verdict: "failed", findings: [{ findingId: "seeded-defect", severity: "critical", description: "seeded correctness defect" }], testEvidenceIds: [] },
      "quality",
      proof,
      headContext("quality"),
    );
    expect(certification.certifiedByDepartment).toBe("quality");
    expect(certification.producingDepartment).toBe("product");
    const report = await generateConcertmasterFinalReport(pool, goalId);
    expect(report.success).toBe(false);
    expect(report.blockers.length).toBeGreaterThan(0);
    expect(report.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "certification_verdict_not_passed" }),
      expect.objectContaining({ reason: "unwaived_critical_finding" }),
    ]));
    expect(report.criticalActionAwaitingApproval).toBe(true);
    expect(report.independentValidation).toContain("quality: failed");
    expect(report.whatChanged).toContain("mission: seed implementation defect");
  });

  it("rejects forged evidence references in both Metronome challenges and Quality certification", async () => {
    const { goalId, worker, proof } = await setupWorkerWithRealCommit(pool, repositoryPath, baseRevision, worktreePaths);
    const fabricatedEvidenceId = randomUUID();
    await expect(raiseMetronomeChallenge(pool, goalId, [], { reason: "forged challenge", evidenceReferences: [fabricatedEvidenceId] }, proof, metronomeContext())).rejects.toBeInstanceOf(MetronomeChallengeError);
    await expect(certifyQuality(
      pool,
      worker.workerId,
      { verdict: "passed", findings: [], testEvidenceIds: [fabricatedEvidenceId] },
      "quality",
      proof,
      headContext("quality"),
    )).rejects.toBeInstanceOf(CertificationError);
    const challengeRows = await pool.query("SELECT 1 FROM metronome_challenges WHERE goal_id = $1", [goalId]);
    const certificationRows = await pool.query("SELECT 1 FROM quality_certifications WHERE goal_id = $1", [goalId]);
    expect(challengeRows.rowCount).toBe(0);
    expect(certificationRows.rowCount).toBe(0);
  });

  it("exposes no remote push, merge, history rewrite, release, or deployment capability", async () => {
    const exportedKeys = [...Object.keys(gitAdapter), ...Object.keys(localGitPort)];
    const forbidden = /push|remote|merge|rebase|reset|hard|release|deploy/i;
    for (const key of exportedKeys) expect(key).not.toMatch(forbidden);
    expect(execFileSync("git", ["remote"], { cwd: repositoryPath }).toString().trim()).toBe("");
    expect(() => execFileSync("git", ["push"], { cwd: repositoryPath, stdio: "pipe" })).toThrow();
  });
});
