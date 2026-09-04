import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getGoalControl } from "./authority.js";
import { scanGoalForMetronomeFindings } from "./metronome.js";
import { createDepartmentPlan, reviseDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { spawnWorker } from "./worker.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { acquireGoalLease, StaleGoalLeaseError } from "./commands.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { raiseMetronomeChallenge, readMetronomeChallenge, requestMetronomeCorrection, requestMetronomeSafePause, resolveMetronomeChallenge, MetronomeAuthorizationError, MetronomeChallengeError, MetronomeChallengeNotFoundError } from "./metronome-challenge.js";

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
const metronomeContext = (label: string) => ({ actorId: "  encore-metronome  ", sessionRef: `metronome-session:${label}`, commandId: randomUUID() });
const planSubstance = (contribution = "own the product slice"): DepartmentPlanSubstance => ({
  contribution, nonGoals: [],
  items: [{ itemId: "exec-1", kind: "execution", objective: "implement", dependsOn: [], scoutQuestion: "", workerAssignment: "implement", evidenceReferences: [] }],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
});

describeDatabase("Metronome challenges with PostgreSQL", () => {
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
    await pool.query("DROP TABLE IF EXISTS metronome_challenge_findings, metronome_challenges, metronome_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE metronome_challenge_findings, metronome_challenges, metronome_findings, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("raises a challenge grounded in a real finding with durable evidence, requests a bounded correction, and lets a non-Metronome actor resolve it", async () => {
    const { goalId, proof } = await setupGoalWithFinding();
    const [finding] = await scanGoalForMetronomeFindings(pool, goalId, proof, metronomeContext("finding"));
    expect(finding).toBeDefined();
    const substance = { reason: "stale worker detected", evidenceReferences: [...evidence.references] };
    const challenge = await raiseMetronomeChallenge(pool, goalId, [finding!.findingId], substance, proof, metronomeContext("raise"));
    expect(challenge.status).toBe("open");
    expect(challenge.raisedBy).toBe("encore-metronome");
    const retry = await raiseMetronomeChallenge(pool, goalId, [finding!.findingId], substance, proof, metronomeContext("retry"));
    expect(retry).toEqual(challenge);
    await expect(pool.query("SELECT challenge_id FROM metronome_challenges WHERE goal_id = $1", [goalId])).resolves.toMatchObject({ rowCount: 1 });
    const corrected = await requestMetronomeCorrection(pool, challenge.challengeId, "replace the stale worker with one bound to the current plan version", proof, metronomeContext("correction"));
    expect(corrected.status).toBe("correction_requested");
    const resolved = await resolveMetronomeChallenge(pool, challenge.challengeId, "head:product", "worker replaced", proof, headContext("product"));
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedBy).toBe("head:product");
  });

  it("rejects Metronome resolving its own challenge and rejects a challenge citing a nonexistent finding or fabricated evidence", async () => {
    const { goalId, proof } = await setupGoalWithFinding();
    const challenge = await raiseMetronomeChallenge(pool, goalId, [], { reason: "generic concern", evidenceReferences: [] }, proof, metronomeContext("raise"));
    await expect(resolveMetronomeChallenge(pool, challenge.challengeId, " encore-metronome ", "self-resolved", proof, metronomeContext("self-resolution"))).rejects.toThrow();
    await expect(raiseMetronomeChallenge(pool, goalId, [randomUUID()], { reason: "x", evidenceReferences: [] }, proof, metronomeContext("bad-finding"))).rejects.toBeInstanceOf(MetronomeChallengeError);
    await expect(raiseMetronomeChallenge(pool, goalId, [], { reason: "x", evidenceReferences: ["fabricated"] }, proof, metronomeContext("bad-evidence"))).rejects.toBeInstanceOf(MetronomeChallengeError);
  });

  it("rolls back the safe pause when recording its challenge status fails", async () => {
    const { goalId, projectId, proof } = await setupGoalWithFinding();
    const challenge = await raiseMetronomeChallenge(pool, goalId, [], { reason: "atomic pause", evidenceReferences: [] }, proof, metronomeContext("atomic-raise"));
    await pool.query(`
      CREATE OR REPLACE FUNCTION fail_metronome_safe_pause()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected safe-pause status failure';
      END;
      $$;
    `);
    await pool.query(`
      CREATE TRIGGER metronome_safe_pause_failure
      BEFORE UPDATE OF status ON metronome_challenges
      FOR EACH ROW EXECUTE FUNCTION fail_metronome_safe_pause();
    `);
    try {
      await expect(requestMetronomeSafePause(pool, challenge.challengeId, projectId, proof, metronomeContext("atomic-pause"))).rejects.toThrow("injected safe-pause status failure");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS metronome_safe_pause_failure ON metronome_challenges");
      await pool.query("DROP FUNCTION IF EXISTS fail_metronome_safe_pause()");
    }
    const control = await getGoalControl(pool, projectId, goalId);
    expect(control.pauseRequestedAt).toBeUndefined();
    await expect(readMetronomeChallenge(pool, challenge.challengeId)).resolves.toMatchObject({ status: "open" });
  });

  it("requests a real safe pause through the Phase 1 authority mechanism and is idempotent/final once resolved", async () => {
    const { goalId, projectId, proof } = await setupGoalWithFinding();
    const challenge = await raiseMetronomeChallenge(pool, goalId, [], { reason: "material risk", evidenceReferences: [] }, proof, metronomeContext("raise"));
    const paused = await requestMetronomeSafePause(pool, challenge.challengeId, projectId, proof, metronomeContext("safe-pause"));
    expect(paused.status).toBe("safe_paused");
    const control = await getGoalControl(pool, projectId, goalId);
    expect(control.pauseRequestedAt).toBeDefined();
    const resolved = await resolveMetronomeChallenge(pool, challenge.challengeId, "head:product", "reviewed and cleared", proof, headContext("product"));
    const resolvedAgain = await resolveMetronomeChallenge(pool, challenge.challengeId, "head:product", "duplicate call", proof, headContext("product"));
    expect(resolvedAgain).toEqual(resolved);
    await expect(requestMetronomeCorrection(pool, challenge.challengeId, "too late", proof, metronomeContext("too-late"))).rejects.toBeInstanceOf(MetronomeChallengeError);
    await expect(pool.query("UPDATE metronome_challenges SET reason = 'tampered' WHERE challenge_id = $1", [challenge.challengeId])).rejects.toThrow();
  });

  it("rejects arbitrary actors from challenge mutation and rejects a project/Goal mismatch before pause", async () => {
    const { goalId, projectId, proof } = await setupGoalWithFinding();
    const challenge = await raiseMetronomeChallenge(pool, goalId, [], { reason: "authorization boundary", evidenceReferences: [] }, proof, metronomeContext("raise"));
    const intruder = context("intruder");
    await expect(raiseMetronomeChallenge(pool, goalId, [], { reason: "bare caller", evidenceReferences: [] })).rejects.toBeInstanceOf(MetronomeAuthorizationError);
    await expect(requestMetronomeCorrection(pool, challenge.challengeId, "bounded correction", proof, intruder)).rejects.toThrow();
    await expect(requestMetronomeSafePause(pool, challenge.challengeId, randomUUID(), proof, metronomeContext("wrong-project"))).rejects.toThrow(/project/i);
    await expect(resolveMetronomeChallenge(pool, challenge.challengeId, "head:product", "intruder resolution", proof, intruder)).rejects.toThrow();
    const control = await getGoalControl(pool, projectId, goalId);
    expect(control.pauseRequestedAt).toBeUndefined();
  });

  it("throws MetronomeChallengeNotFoundError for a missing challenge", async () => {
    await expect(readMetronomeChallenge(pool, randomUUID())).rejects.toBeInstanceOf(MetronomeChallengeNotFoundError);
  });

  it("rejects raising a Metronome challenge with a stale/forged fencing token, zero durable mutation, and the real proof still works afterward (Phase 2 re-patch item 8)", async () => {
    const { goalId, proof } = await setupGoalWithFinding();
    const forgedProof = { goalId, ownerId: proof.ownerId, fencingToken: String(BigInt(proof.fencingToken) + 1n) };
    const substance = { reason: "forged fencing attempt", evidenceReferences: [] };
    await expect(raiseMetronomeChallenge(pool, goalId, [], substance, forgedProof, metronomeContext("forged"))).rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM metronome_challenges WHERE goal_id = $1", [goalId])).rows[0]!.count).toBe(0);
    const challenge = await raiseMetronomeChallenge(pool, goalId, [], substance, proof, metronomeContext("real"));
    expect(challenge.status).toBe("open");
  });
});
