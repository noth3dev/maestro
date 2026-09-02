import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash, type DecisionPacket, type DepartmentPlanSubstance, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { createDepartmentPlan, DepartmentPlanError, DepartmentPlanNotFoundError, listDepartmentPlansForCouncil, readDepartmentPlan, reviseDepartmentPlan } from "./department-plan.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0014_head_activation_runtime_safety.sql", "0015_council_protocol.sql", "0016_council_hardening.sql", "0018_role_identity_hardening.sql", "0019_council_authority_hardening.sql", "0020_head_role_identity_hardening.sql", "0021_council_round_idempotency.sql", "0022_department_plans.sql"];

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

const substance = (overrides: Partial<DepartmentPlanSubstance> = {}): DepartmentPlanSubstance => ({
  contribution: "own the product slice", nonGoals: ["UI polish"],
  items: [{ itemId: "item-1", kind: "scout", objective: "assess risk", dependsOn: [], scoutQuestion: "what changed?", workerAssignment: "", evidenceReferences: [] }],
  requiredHandoffs: [], budgetCeiling: "10 USD", expectedTime: "1 day", maxRetries: 1, maxWorkers: 1,
  gitRepository: "repo", gitBranch: "phase2/product", integrationPath: "packages/product",
  risks: [], safePausePoints: [], escalationTriggers: [], evidenceReferences: [], validationCriteria: ["tests pass"],
  ...overrides,
});

describeDatabase("Department Plans with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupResolvedCouncil(departments = ["product"], ownedDepartments = departments) {
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
      rejectedAlternatives: [], departmentOwnership: ownedDepartments.map((departmentId) => ({ departmentId, responsibility: "own it" })),
      workerPlan: [], completionCriteria: ["done"], failureCriteria: ["fail"], dissent: [], uncertainty: [],
      criticalActions: [], unresolvedConflicts: [], evidenceReferences: [],
    };
    const resolved = await recordCouncilDecisionPacket(pool, council.councilId, packet, proof, context("decision"));
    return { goalId, contractId, projectId, proof, council: resolved };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS department_plan_revisions, department_plans, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE department_plan_revisions, department_plans, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates exactly one plan for a captured, authorized Head after a resolved executable decision", async () => {
    const { council, proof } = await setupResolvedCouncil(["product"]);
    const plan = await createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"));
    expect(plan.version).toBe(1);
    expect(plan.councilId).toBe(council.councilId);
    expect(plan.contractId).toBe(council.contractId);
    expect(plan.headRoleId).toBe("head:product");
    const loaded = await readDepartmentPlan(pool, council.councilId, "product");
    expect(loaded).toEqual(plan);
    const listed = await listDepartmentPlansForCouncil(pool, council.councilId);
    expect(listed).toEqual([plan]);
  });

  it("rejects plan creation for a Council that is not resolved/executable", async () => {
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
    await expect(createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"))).rejects.toBeInstanceOf(DepartmentPlanError);
    expect((await listDepartmentPlansForCouncil(pool, council.councilId)).length).toBe(0);
  });

  it("rejects plan creation from an unauthorized actor", async () => {
    const { council, proof } = await setupResolvedCouncil(["product"]);
    await expect(createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, context("not-the-head"))).rejects.toBeInstanceOf(DepartmentPlanError);
    expect((await listDepartmentPlansForCouncil(pool, council.councilId)).length).toBe(0);
  });

  it("makes duplicate-content plan creation idempotent and rejects a differing duplicate", async () => {
    const { council, proof } = await setupResolvedCouncil(["product"]);
    const first = await createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"));
    const replay = await createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"));
    expect(replay).toEqual(first);
    await expect(createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance({ contribution: "different" }) }, proof, headContext("product"))).rejects.toBeInstanceOf(DepartmentPlanError);
  });

  it("revises a plan with an optimistic version check, keeps history append-only, and preserves old versions", async () => {
    const { council, proof } = await setupResolvedCouncil(["product"]);
    const v1 = await createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"));
    const v2 = await reviseDepartmentPlan(pool, council.councilId, "product", 1, substance({ contribution: "revised contribution" }), "evidence changed", proof, headContext("product"));
    expect(v2.version).toBe(2);
    expect(v2.substance.contribution).toBe("revised contribution");
    await expect(reviseDepartmentPlan(pool, council.councilId, "product", 1, substance({ contribution: "stale" }), "stale retry", proof, headContext("product"))).rejects.toBeInstanceOf(DepartmentPlanError);
    const revisions = await pool.query("SELECT version, content_hash FROM department_plan_revisions WHERE council_id = $1 AND department_id = $2 ORDER BY version", [council.councilId, "product"]);
    expect(revisions.rows.map((row: { version: number }) => row.version)).toEqual([1, 2]);
    await expect(pool.query("UPDATE department_plan_revisions SET reason = $1 WHERE council_id = $2 AND department_id = $3 AND version = 1", ["tampered", council.councilId, "product"])).rejects.toThrow();
    expect(v1.version).toBe(1);
  });

  it("rejects Department Plan creation for a captured Department the Council did not assign ownership to", async () => {
    const { council, proof } = await setupResolvedCouncil(["product", "engineering"], ["product"]);
    await expect(createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "engineering", substance: substance() }, proof, headContext("engineering"))).rejects.toBeInstanceOf(DepartmentPlanError);
    const owned = await createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"));
    expect(owned.departmentId).toBe("product");
  });

  it("denies Department Plan writes once the Goal is paused", async () => {
    const { council, proof, projectId, goalId } = await setupResolvedCouncil(["product"]);
    await pool.query("INSERT INTO goal_controls (project_id, goal_id, pause_requested_at, paused_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp()) ON CONFLICT (project_id, goal_id) DO UPDATE SET pause_requested_at = clock_timestamp(), paused_at = clock_timestamp()", [projectId, goalId]);
    await expect(createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"))).rejects.toThrow();
  });

  it("throws DepartmentPlanNotFoundError for a plan that does not exist", async () => {
    await expect(readDepartmentPlan(pool, randomUUID(), "product")).rejects.toBeInstanceOf(DepartmentPlanNotFoundError);
  });

  it("rejects direct tampering with the immutable Council/Contract binding", async () => {
    const { council, proof } = await setupResolvedCouncil(["product"]);
    await createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"));
    await expect(pool.query("UPDATE department_plans SET council_snapshot_hash = $1 WHERE council_id = $2 AND department_id = $3", ["0".repeat(64), council.councilId, "product"])).rejects.toThrow();
    await expect(pool.query("UPDATE department_plans SET decision_packet_hash = $1 WHERE council_id = $2 AND department_id = $3", ["0".repeat(64), council.councilId, "product"])).rejects.toThrow();
  });

  it("makes a lost-response revision retry idempotent instead of a false version conflict", async () => {
    const { council, proof } = await setupResolvedCouncil(["product"]);
    await createDepartmentPlan(pool, { councilId: council.councilId, departmentId: "product", substance: substance() }, proof, headContext("product"));
    const revised = { ...substance(), contribution: "revised once" };
    const applied = await reviseDepartmentPlan(pool, council.councilId, "product", 1, revised, "evidence changed", proof, headContext("product"));
    expect(applied.version).toBe(2);
    // Simulate a lost response: caller retries the exact same call with the same expectedVersion (1).
    const retried = await reviseDepartmentPlan(pool, council.councilId, "product", 1, revised, "evidence changed", proof, headContext("product"));
    expect(retried).toEqual(applied);
    const revisions = await pool.query("SELECT version FROM department_plan_revisions WHERE council_id = $1 AND department_id = $2 ORDER BY version", [council.councilId, "product"]);
    expect(revisions.rows.map((row: { version: number }) => row.version)).toEqual([1, 2]);
  });
});
