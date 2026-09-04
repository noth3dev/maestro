import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type ExecutionKernelPort, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance, type TeamLeadGrantSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease, StaleGoalLeaseError } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan, reviseDepartmentPlan } from "./department-plan.js";
import { createMissionBundle } from "./mission-bundle.js";
import { spawnWorker } from "./worker.js";
import { grantTeamLead, readTeamLeadGrant, revokeTeamLeadGrant, spawnHelperWorker, TeamLeadGrantError, TeamLeadGrantNotFoundError } from "./team-lead-grant.js";

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

const planSubstance = (): DepartmentPlanSubstance => ({
  contribution: "own the product slice", nonGoals: [],
  items: [{ itemId: "exec-1", kind: "execution", objective: "large mission", dependsOn: [], scoutQuestion: "", workerAssignment: "implement a large change", evidenceReferences: [] }],
  requiredHandoffs: [], budgetCeiling: "50 USD", expectedTime: "3 days", maxRetries: 1, maxWorkers: 3,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
});
const bundleSubstance = (): MissionBundleSubstance => ({
  role: "execution", profileRef: "profile-1", goalBrief: "implement a large change",
  approvedModels: ["model-a"], allowedSkills: ["implementation"], allowedTools: ["write"], allowedPaths: ["packages/product"],
  environment: ["node24"], authorityBoundary: ["write-scoped"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
  costCeiling: "20 USD", timeCeiling: "1 day", retryCeiling: 1, workerCeiling: 0,
  deliverable: "an implemented change", evidenceRequirements: ["diff"], validationCriteria: ["tests pass"],
  terminationConditions: ["deadline passed"],
});
const grantSubstance = (overrides: Partial<TeamLeadGrantSubstance> = {}): TeamLeadGrantSubstance => ({
  reason: "large mission needs parallel helpers", maxHelpers: 2, costCeiling: "10 USD", durationCeiling: "1 day",
  taskScope: "parallel subsystem work", reportingRequirement: "daily status",
  ...overrides,
});

function fakeKernel(): ExecutionKernelPort {
  let counter = 0;
  return {
    async spawn() {
      counter += 1;
      return { execution: `exec-${counter}` as never, invocation: `inv-${counter}` as never };
    },
    async prompt() {}, async sendMessage() {},
    async observe() { return []; },
    async cancel() { return { cancelled: true }; },
    async getModelIdentity() { return { provider: "fake", id: "fake" }; },
    async getToolEvents() { return { state: "empty", events: [] }; },
    async getUsage() { return { state: "available", totalTokens: 1 }; },
    async getInvocationStatus() { return "running"; },
    async resume() { throw new Error("not supported"); },
    async reconnect() { throw new Error("not supported"); },
  };
}

describeDatabase("Team-lead grants and helper workers with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupWorker(departments = ["product"]) {
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
    for (const departmentId of departments) await pool.query("INSERT INTO goal_head_participations (goal_id, department_id, head_role_id, contract_id, status, active_session_ref) VALUES ($1, $2, $3, $4, 'active', $5)", [goalId, departmentId, `head:${departmentId}`, contractId, `opaque:${departmentId}`]);
    const proof = await acquireGoalLease(pool, { goalId, ownerId: "test", leaseDurationMs: 60_000 });
    const council = await createHeadCouncil(pool, { goalId, contractId, briefDeadline: new Date(Date.now() + 60_000), evidence }, proof, context("secretary"));
    for (const departmentId of departments) await submitIndependentBrief(pool, council.councilId, departmentId, brief, proof, headContext(departmentId));
    await revealCouncilBriefs(pool, council.councilId, proof, context("reveal"));
    const packet: DecisionPacket = {
      outcome: "decided", executionDisposition: "executable", selectedDirection: "proceed",
      rejectedAlternatives: [], departmentOwnership: departments.map((departmentId) => ({ departmentId, responsibility: "own it" })),
      workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    const plan = await createDepartmentPlan(pool, { councilId: resolved.councilId, departmentId: "product", substance: planSubstance() }, proof, headContext("product"));
    await createMissionBundle(pool, { councilId: resolved.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance() }, proof, headContext("product"));
    const kernel = fakeKernel();
    const worker = await spawnWorker(pool, kernel, { councilId: resolved.councilId, departmentId: "product", planVersion: plan.version, itemId: "exec-1" }, proof, headContext("product"));
    return { proof, council: resolved, plan, worker, kernel };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS team_lead_grants, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
  });
  beforeEach(async () => { await pool.query("TRUNCATE team_lead_grants, workers, mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("grants team lead to an active worker by the captured Head and spawns helpers up to the ceiling", async () => {
    const { proof, worker, kernel } = await setupWorker();
    const grant = await grantTeamLead(pool, worker.workerId, grantSubstance({ maxHelpers: 2 }), proof, headContext("product"));
    expect(grant.revoked).toBe(false);
    const helper1 = await spawnHelperWorker(pool, kernel, grant.grantId, proof, headContext("product"));
    const helper2 = await spawnHelperWorker(pool, kernel, grant.grantId, proof, headContext("product"));
    expect(helper1.itemId).toBe(worker.itemId);
    expect(helper2.attempt).not.toBe(helper1.attempt);
    await expect(spawnHelperWorker(pool, kernel, grant.grantId, proof, headContext("product"))).rejects.toBeInstanceOf(TeamLeadGrantError);
  });

  it("rejects granting team lead to a helper worker (no recursive spawning)", async () => {
    const { proof, worker, kernel } = await setupWorker();
    const grant = await grantTeamLead(pool, worker.workerId, grantSubstance({ maxHelpers: 1 }), proof, headContext("product"));
    const helper = await spawnHelperWorker(pool, kernel, grant.grantId, proof, headContext("product"));
    await expect(grantTeamLead(pool, helper.workerId, grantSubstance(), proof, headContext("product"))).rejects.toBeInstanceOf(TeamLeadGrantError);
  });

  it("rejects an unauthorized grant and helper spawn", async () => {
    const { proof, worker, kernel } = await setupWorker();
    await expect(grantTeamLead(pool, worker.workerId, grantSubstance(), proof, context("not-the-head"))).rejects.toBeInstanceOf(TeamLeadGrantError);
    const grant = await grantTeamLead(pool, worker.workerId, grantSubstance(), proof, headContext("product"));
    await expect(spawnHelperWorker(pool, kernel, grant.grantId, proof, context("not-the-head"))).rejects.toBeInstanceOf(TeamLeadGrantError);
  });

  it("revokes a grant once, is idempotent on retry, and blocks further helper spawns", async () => {
    const { proof, worker, kernel } = await setupWorker();
    const grant = await grantTeamLead(pool, worker.workerId, grantSubstance({ maxHelpers: 2 }), proof, headContext("product"));
    const revoked = await revokeTeamLeadGrant(pool, grant.grantId, proof, headContext("product"));
    expect(revoked.revoked).toBe(true);
    const revokedAgain = await revokeTeamLeadGrant(pool, grant.grantId, proof, headContext("product"));
    expect(revokedAgain).toEqual(revoked);
    await expect(spawnHelperWorker(pool, kernel, grant.grantId, proof, headContext("product"))).rejects.toBeInstanceOf(TeamLeadGrantError);
    await expect(pool.query("UPDATE team_lead_grants SET max_helpers = 99 WHERE grant_id = $1", [grant.grantId])).rejects.toThrow();
  });

  it("throws TeamLeadGrantNotFoundError for a missing grant", async () => {
    await expect(readTeamLeadGrant(pool, randomUUID())).rejects.toBeInstanceOf(TeamLeadGrantNotFoundError);
  });

  it("rejects a helper spawn that would exceed the grant's duration ceiling", async () => {
    const { proof, worker, kernel, council, plan } = await setupWorker();
    const grantId = randomUUID();
    await pool.query(
      `INSERT INTO team_lead_grants (grant_id, worker_id, council_id, department_id, plan_version, item_id, reason, max_helpers, cost_ceiling, duration_ceiling, task_scope, reporting_requirement, granted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, transaction_timestamp() - interval '10 days')`,
      [grantId, worker.workerId, council.councilId, "product", plan.version, worker.itemId, "large mission needs parallel helpers", 5, "100 USD", "1 day", "parallel subsystem work", "daily status"],
    );
    await expect(spawnHelperWorker(pool, kernel, grantId, proof, headContext("product"))).rejects.toThrow(/duration ceiling exceeded/);
  });

  it("rejects every team-lead write with a stale fencing token and leaves durable state unchanged", async () => {
    const { proof, worker, kernel } = await setupWorker();
    const forgedProof = { goalId: proof.goalId, ownerId: proof.ownerId, fencingToken: String(BigInt(proof.fencingToken) + 1n) };

    await expect(grantTeamLead(pool, worker.workerId, grantSubstance(), forgedProof, headContext("product")))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM team_lead_grants WHERE worker_id = $1", [worker.workerId])).rows[0]!.count).toBe(0);
    const grant = await grantTeamLead(pool, worker.workerId, grantSubstance(), proof, headContext("product"));

    await expect(spawnHelperWorker(pool, kernel, grant.grantId, forgedProof, headContext("product")))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM workers WHERE grant_id = $1", [grant.grantId])).rows[0]!.count).toBe(0);
    const helper = await spawnHelperWorker(pool, kernel, grant.grantId, proof, headContext("product"));
    expect((await pool.query("SELECT parent_worker_id FROM workers WHERE worker_id = $1", [helper.workerId])).rows[0]!.parent_worker_id).toBe(worker.workerId);

    await expect(revokeTeamLeadGrant(pool, grant.grantId, forgedProof, headContext("product")))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await readTeamLeadGrant(pool, grant.grantId)).revoked).toBe(false);
    const revoked = await revokeTeamLeadGrant(pool, grant.grantId, proof, headContext("product"));
    expect(revoked.revoked).toBe(true);
  });

  it("rejects a helper spawn that would exceed the grant's task scope ceiling once the Department Plan is revised", async () => {
    const { proof, worker, kernel, council, plan } = await setupWorker();
    const grant = await grantTeamLead(pool, worker.workerId, grantSubstance({ maxHelpers: 5, costCeiling: "100 USD" }), proof, headContext("product"));
    const revisedSubstance = { ...planSubstance(), contribution: "own the product slice, expanded" };
    await reviseDepartmentPlan(pool, council.councilId, "product", plan.version, revisedSubstance, "scope expanded", proof, headContext("product"));
    await expect(spawnHelperWorker(pool, kernel, grant.grantId, proof, headContext("product"))).rejects.toThrow(/task scope ceiling exceeded/);
  });
});
