import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getGoalControl } from "./authority.js";
import { scanGoalForSentinelFindings } from "./sentinel.js";
import { createDepartmentPlan, reviseDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { spawnWorker } from "./worker.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { acquireGoalLease } from "./commands.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { raiseSentinelChallenge, readSentinelChallenge, requestSentinelCorrection, requestSentinelSafePause, resolveSentinelChallenge, SentinelChallengeError, SentinelChallengeNotFoundError } from "./sentinel-challenge.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0014_head_activation_runtime_safety.sql", "0015_council_protocol.sql", "0016_council_hardening.sql", "0018_role_identity_hardening.sql", "0019_council_authority_hardening.sql", "0020_head_role_identity_hardening.sql", "0021_council_round_idempotency.sql", "0022_department_plans.sql", "0023_mission_bundles.sql", "0024_workers.sql", "0028_sentinel_findings.sql", "0029_sentinel_challenges.sql"];

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
const planSubstance = (contribution = "own the product slice"): DepartmentPlanSubstance => ({
  contribution, nonGoals: [],
  items: [{ itemId: "exec-1", kind: "execution", objective: "implement", dependsOn: [], scoutQuestion: "", workerAssignment: "implement", evidenceReferences: [] }],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
});

describeDatabase("Sentinel challenges with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupGoalWithFinding() {
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
    await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, 'product', 'head:product', $2, 'active', 'opaque:product')", [goalId, contractId]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"));
    await submitIndependentBrief(pool, council.councilId, "product", brief, proof, headContext("product"));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const packet: DecisionPacket = {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
      rejectedAlternatives: [], departmentOwnership: [{ departmentId: "product", responsibility: "own it" }],
      workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance() }, proof, headContext("product"));
    const bundleSubstance = {
      role: "execution" as const, profileRef: "profile-1", goalBrief: "implement",
      approvedModels: ["model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/product"],
      environment: ["node24"], authorityBoundary: ["write-scoped"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
      costCeiling: "5 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
      deliverable: "a change", evidenceRequirements: ["diff"], validationCriteria: ["tests pass"],
      terminationConditions: ["deadline passed"],
    };
    await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance }, proof, headContext("product"));
    const kernel: ExecutionKernelPort = {
      async spawn() { return { execution: "exec-1" as never, invocation: "inv-1" as never }; },
      async prompt() {}, async sendMessage() {}, async observe() { return []; },
      async cancel() { return { cancelled: true }; },
      async getModelIdentity() { return { provider: "fake", id: "fake" }; },
      async getToolEvents() { return { state: "empty", events: [] }; },
      async getUsage() { return { state: "available", totalTokens: 1 }; },
      async getInvocationStatus() { return "running"; },
      async resume() { throw new Error("not supported"); },
      async reconnect() { throw new Error("not supported"); },
    };
    await spawnWorker(pool, kernel, { councilId: resolved.councilId, departmentId: "product", planVersion: plan.version, itemId: "exec-1" }, proof, headContext("product"));
    await reviseDepartmentPlan(pool, resolved.councilId, "product", plan.version, planSubstance("revised contribution"), "evidence changed", proof, headContext("product"));
    return { goalId, projectId };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS sentinel_challenge_findings, sentinel_challenges, sentinel_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE sentinel_challenge_findings, sentinel_challenges, sentinel_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("raises a challenge grounded in a real finding with durable evidence, requests a bounded correction, and lets a non-Sentinel actor resolve it", async () => {
    const { goalId } = await setupGoalWithFinding();
    const [finding] = await scanGoalForSentinelFindings(pool, goalId);
    expect(finding).toBeDefined();
    const challenge = await raiseSentinelChallenge(pool, goalId, [finding!.findingId], { reason: "stale worker detected", evidenceReferences: [...evidence.references] });
    expect(challenge.status).toBe("open");
    expect(challenge.raisedBy).toBe("sentinel");
    const corrected = await requestSentinelCorrection(pool, challenge.challengeId, "replace the stale worker with one bound to the current plan version");
    expect(corrected.status).toBe("correction_requested");
    const resolved = await resolveSentinelChallenge(pool, challenge.challengeId, "head:product", "worker replaced");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedBy).toBe("head:product");
  });

  it("rejects Sentinel resolving its own challenge and rejects a challenge citing a nonexistent finding or fabricated evidence", async () => {
    const { goalId } = await setupGoalWithFinding();
    const challenge = await raiseSentinelChallenge(pool, goalId, [], { reason: "generic concern", evidenceReferences: [] });
    await expect(resolveSentinelChallenge(pool, challenge.challengeId, "sentinel", "self-resolved")).rejects.toThrow();
    await expect(raiseSentinelChallenge(pool, goalId, [randomUUID()], { reason: "x", evidenceReferences: [] })).rejects.toBeInstanceOf(SentinelChallengeError);
    await expect(raiseSentinelChallenge(pool, goalId, [], { reason: "x", evidenceReferences: ["fabricated"] })).rejects.toBeInstanceOf(SentinelChallengeError);
  });

  it("requests a real safe pause through the Phase 1 authority mechanism and is idempotent/final once resolved", async () => {
    const { goalId, projectId } = await setupGoalWithFinding();
    const challenge = await raiseSentinelChallenge(pool, goalId, [], { reason: "material risk", evidenceReferences: [] });
    const paused = await requestSentinelSafePause(pool, challenge.challengeId, projectId);
    expect(paused.status).toBe("safe_paused");
    const control = await getGoalControl(pool, projectId, goalId);
    expect(control.pauseRequestedAt).toBeDefined();
    const resolved = await resolveSentinelChallenge(pool, challenge.challengeId, "sane", "reviewed and cleared");
    const resolvedAgain = await resolveSentinelChallenge(pool, challenge.challengeId, "sane", "duplicate call");
    expect(resolvedAgain).toEqual(resolved);
    await expect(requestSentinelCorrection(pool, challenge.challengeId, "too late")).rejects.toBeInstanceOf(SentinelChallengeError);
    await expect(pool.query("UPDATE sentinel_challenges SET reason = 'tampered' WHERE challenge_id = $1", [challenge.challengeId])).rejects.toThrow();
  });

  it("throws SentinelChallengeNotFoundError for a missing challenge", async () => {
    await expect(readSentinelChallenge(pool, randomUUID())).rejects.toBeInstanceOf(SentinelChallengeNotFoundError);
  });
});
