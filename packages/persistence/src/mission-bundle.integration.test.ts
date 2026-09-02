import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type IndependentBrief, type MissionBundleSubstance, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan } from "./department-plan.js";
import { createMissionBundle, listMissionBundlesForPlan, MissionBundleError, readMissionBundle, MissionBundleNotFoundError } from "./mission-bundle.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0014_head_activation_runtime_safety.sql", "0015_council_protocol.sql", "0016_council_hardening.sql", "0018_role_identity_hardening.sql", "0019_council_authority_hardening.sql", "0020_head_role_identity_hardening.sql", "0021_council_round_idempotency.sql", "0022_department_plans.sql", "0023_mission_bundles.sql"];

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
  items: [
    { itemId: "scout-1", kind: "scout", objective: "assess risk", dependsOn: [], scoutQuestion: "what changed?", workerAssignment: "", evidenceReferences: [] },
    { itemId: "exec-1", kind: "execution", objective: "implement fix", dependsOn: ["scout-1"], scoutQuestion: "", workerAssignment: "implement the fix", evidenceReferences: [] },
  ],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 2,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
});

const bundleSubstance = (overrides: Partial<MissionBundleSubstance> = {}): MissionBundleSubstance => ({
  role: "scout", profileRef: "profile-1", goalBrief: "assess risk before implementation",
  approvedModels: ["model-a"], allowedSkills: ["research"], allowedTools: ["read"], allowedPaths: ["packages/product"],
  environment: ["node24"], authorityBoundary: ["read-only"], externalServiceBoundary: ["none"], dataBoundary: ["repository files only"],
  costCeiling: "1 USD", timeCeiling: "1 hour", retryCeiling: 1, workerCeiling: 0,
  deliverable: "a risk report", evidenceRequirements: ["citations"], validationCriteria: ["report reviewed"],
  terminationConditions: ["deadline passed"],
  ...overrides,
});

describeDatabase("Mission Bundles with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupPlan(departments = ["product"]) {
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
    return { goalId, contractId, projectId, proof, council: resolved, plan };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS mission_bundles, department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE mission_bundles, department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("issues a Mission Bundle bound to a real Plan item by the captured Head", async () => {
    const { council, plan, proof } = await setupPlan();
    const bundle = await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    expect(bundle.planVersion).toBe(plan.version);
    expect(bundle.itemId).toBe("scout-1");
    const loaded = await readMissionBundle(pool, council.councilId, "product", plan.version, "scout-1");
    expect(loaded).toEqual(bundle);
  });

  it("rejects a bundle whose role does not match the plan item kind", async () => {
    const { council, proof } = await setupPlan();
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "exec-1", substance: bundleSubstance({ role: "scout" }) }, proof, headContext("product"))).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("rejects a bundle for an unknown plan item", async () => {
    const { council, proof } = await setupPlan();
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "missing", substance: bundleSubstance() }, proof, headContext("product"))).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("rejects an unauthorized issuer", async () => {
    const { council, proof } = await setupPlan();
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, context("not-the-head"))).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("makes duplicate-content bundle creation idempotent and rejects a differing duplicate", async () => {
    const { council, proof } = await setupPlan();
    const first = await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    const replay = await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    expect(replay).toEqual(first);
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance({ costCeiling: "999 USD" }) }, proof, headContext("product"))).rejects.toBeInstanceOf(MissionBundleError);
  });

  it("lists all bundles for a plan version and rejects direct mutation of an issued bundle", async () => {
    const { council, plan, proof } = await setupPlan();
    await createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"));
    const listed = await listMissionBundlesForPlan(pool, council.councilId, "product", plan.version);
    expect(listed.length).toBe(1);
    await expect(pool.query("UPDATE mission_bundles SET content_hash = $1 WHERE council_id = $2", ["0".repeat(64), council.councilId])).rejects.toThrow();
  });

  it("denies Mission Bundle writes once the Goal is paused", async () => {
    const { council, proof, projectId, goalId } = await setupPlan();
    await pool.query("INSERT INTO goal_controls (project_id, goal_id, pause_requested_at, paused_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp()) ON CONFLICT (project_id, goal_id) DO UPDATE SET pause_requested_at = clock_timestamp(), paused_at = clock_timestamp()", [projectId, goalId]);
    await expect(createMissionBundle(pool, { councilId: council.councilId, departmentId: "product", itemId: "scout-1", substance: bundleSubstance() }, proof, headContext("product"))).rejects.toThrow();
  });

  it("throws MissionBundleNotFoundError for a missing bundle", async () => {
    await expect(readMissionBundle(pool, randomUUID(), "product", 1, "scout-1")).rejects.toBeInstanceOf(MissionBundleNotFoundError);
  });
});
