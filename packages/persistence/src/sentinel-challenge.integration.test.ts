import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getGoalControl } from "./authority.js";
import { scanGoalForSentinelFindings } from "./sentinel.js";
import { createDepartmentPlan, reviseDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { spawnWorker } from "./worker.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { acquireGoalLease, StaleGoalLeaseError } from "./commands.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { raiseSentinelChallenge, readSentinelChallenge, requestSentinelCorrection, requestSentinelSafePause, resolveSentinelChallenge, SentinelAuthorizationError, SentinelChallengeError, SentinelChallengeNotFoundError } from "./sentinel-challenge.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

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
const sentinelContext = (label: string) => ({ actorId: "  encore-sentinel  ", sessionRef: `sentinel-session:${label}`, commandId: randomUUID() });
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
    return { goalId, projectId, proof };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS sentinel_challenge_findings, sentinel_challenges, sentinel_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE sentinel_challenge_findings, sentinel_challenges, sentinel_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("raises a challenge grounded in a real finding with durable evidence, requests a bounded correction, and lets a non-Sentinel actor resolve it", async () => {
    const { goalId, proof } = await setupGoalWithFinding();
    const [finding] = await scanGoalForSentinelFindings(pool, goalId, proof, sentinelContext("finding"));
    expect(finding).toBeDefined();
    const substance = { reason: "stale worker detected", evidenceReferences: [...evidence.references] };
    const challenge = await raiseSentinelChallenge(pool, goalId, [finding!.findingId], substance, proof, sentinelContext("raise"));
    expect(challenge.status).toBe("open");
    expect(challenge.raisedBy).toBe("encore-sentinel");
    const retry = await raiseSentinelChallenge(pool, goalId, [finding!.findingId], substance, proof, sentinelContext("retry"));
    expect(retry).toEqual(challenge);
    await expect(pool.query("SELECT challenge_id FROM sentinel_challenges WHERE goal_id = $1", [goalId])).resolves.toMatchObject({ rowCount: 1 });
    const corrected = await requestSentinelCorrection(pool, challenge.challengeId, "replace the stale worker with one bound to the current plan version", proof, sentinelContext("correction"));
    expect(corrected.status).toBe("correction_requested");
    const resolved = await resolveSentinelChallenge(pool, challenge.challengeId, "head:product", "worker replaced", proof, headContext("product"));
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedBy).toBe("head:product");
  });

  it("rejects Sentinel resolving its own challenge and rejects a challenge citing a nonexistent finding or fabricated evidence", async () => {
    const { goalId, proof } = await setupGoalWithFinding();
    const challenge = await raiseSentinelChallenge(pool, goalId, [], { reason: "generic concern", evidenceReferences: [] }, proof, sentinelContext("raise"));
    await expect(resolveSentinelChallenge(pool, challenge.challengeId, " encore-sentinel ", "self-resolved", proof, sentinelContext("self-resolution"))).rejects.toThrow();
    await expect(raiseSentinelChallenge(pool, goalId, [randomUUID()], { reason: "x", evidenceReferences: [] }, proof, sentinelContext("bad-finding"))).rejects.toBeInstanceOf(SentinelChallengeError);
    await expect(raiseSentinelChallenge(pool, goalId, [], { reason: "x", evidenceReferences: ["fabricated"] }, proof, sentinelContext("bad-evidence"))).rejects.toBeInstanceOf(SentinelChallengeError);
  });

  it("rolls back the safe pause when recording its challenge status fails", async () => {
    const { goalId, projectId, proof } = await setupGoalWithFinding();
    const challenge = await raiseSentinelChallenge(pool, goalId, [], { reason: "atomic pause", evidenceReferences: [] }, proof, sentinelContext("atomic-raise"));
    await pool.query(`
      CREATE OR REPLACE FUNCTION fail_sentinel_safe_pause()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected safe-pause status failure';
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER sentinel_safe_pause_failure
      BEFORE UPDATE OF status ON sentinel_challenges
      FOR EACH ROW EXECUTE FUNCTION fail_sentinel_safe_pause();
    `);
    try {
      await expect(requestSentinelSafePause(pool, challenge.challengeId, projectId, proof, sentinelContext("atomic-pause"))).rejects.toThrow("injected safe-pause status failure");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS sentinel_safe_pause_failure ON sentinel_challenges");
      await pool.query("DROP FUNCTION IF EXISTS fail_sentinel_safe_pause()");
    }
    const control = await getGoalControl(pool, projectId, goalId);
    expect(control.pauseRequestedAt).toBeUndefined();
    await expect(readSentinelChallenge(pool, challenge.challengeId)).resolves.toMatchObject({ status: "open" });
  });

  it("requests a real safe pause through the Phase 1 authority mechanism and is idempotent/final once resolved", async () => {
    const { goalId, projectId, proof } = await setupGoalWithFinding();
    const challenge = await raiseSentinelChallenge(pool, goalId, [], { reason: "material risk", evidenceReferences: [] }, proof, sentinelContext("raise"));
    const paused = await requestSentinelSafePause(pool, challenge.challengeId, projectId, proof, sentinelContext("safe-pause"));
    expect(paused.status).toBe("safe_paused");
    const control = await getGoalControl(pool, projectId, goalId);
    expect(control.pauseRequestedAt).toBeDefined();
    const resolved = await resolveSentinelChallenge(pool, challenge.challengeId, "head:product", "reviewed and cleared", proof, headContext("product"));
    const resolvedAgain = await resolveSentinelChallenge(pool, challenge.challengeId, "head:product", "duplicate call", proof, headContext("product"));
    expect(resolvedAgain).toEqual(resolved);
    await expect(requestSentinelCorrection(pool, challenge.challengeId, "too late", proof, sentinelContext("too-late"))).rejects.toBeInstanceOf(SentinelChallengeError);
    await expect(pool.query("UPDATE sentinel_challenges SET reason = 'tampered' WHERE challenge_id = $1", [challenge.challengeId])).rejects.toThrow();
  });

  it("rejects arbitrary actors from challenge mutation and rejects a project/Goal mismatch before pause", async () => {
    const { goalId, projectId, proof } = await setupGoalWithFinding();
    const challenge = await raiseSentinelChallenge(pool, goalId, [], { reason: "authorization boundary", evidenceReferences: [] }, proof, sentinelContext("raise"));
    const intruder = context("intruder");
    await expect(raiseSentinelChallenge(pool, goalId, [], { reason: "bare caller", evidenceReferences: [] })).rejects.toBeInstanceOf(SentinelAuthorizationError);
    await expect(requestSentinelCorrection(pool, challenge.challengeId, "bounded correction", proof, intruder)).rejects.toThrow();
    await expect(requestSentinelSafePause(pool, challenge.challengeId, randomUUID(), proof, sentinelContext("wrong-project"))).rejects.toThrow(/project/i);
    await expect(resolveSentinelChallenge(pool, challenge.challengeId, "head:product", "intruder resolution", proof, intruder)).rejects.toThrow();
    const control = await getGoalControl(pool, projectId, goalId);
    expect(control.pauseRequestedAt).toBeUndefined();
  });

  it("throws SentinelChallengeNotFoundError for a missing challenge", async () => {
    await expect(readSentinelChallenge(pool, randomUUID())).rejects.toBeInstanceOf(SentinelChallengeNotFoundError);
  });

  it("rejects raising a Sentinel challenge with a stale/forged fencing token, zero durable mutation, and the real proof still works afterward (Phase 2 re-patch item 8)", async () => {
    const { goalId, proof } = await setupGoalWithFinding();
    const forgedProof = { goalId, ownerId: proof.ownerId, fencingToken: String(BigInt(proof.fencingToken) + 1n) };
    const substance = { reason: "forged fencing attempt", evidenceReferences: [] };
    await expect(raiseSentinelChallenge(pool, goalId, [], substance, forgedProof, sentinelContext("forged"))).rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM sentinel_challenges WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(0);
    const challenge = await raiseSentinelChallenge(pool, goalId, [], substance, proof, sentinelContext("real"));
    expect(challenge.status).toBe("open");
  });
});
