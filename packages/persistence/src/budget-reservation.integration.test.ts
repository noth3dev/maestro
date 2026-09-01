import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash, type DecisionPacket, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { BudgetReservationError, BudgetReservationNotFoundError, listBudgetForecasts, readBudgetReservation, recordBudgetForecast, reserveDepartmentBudget, reserveGoalBudget, reserveMissionBudget } from "./budget-reservation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = ["0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql", "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql", "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql", "0013_council_briefs.sql", "0014_head_activation_runtime_safety.sql", "0015_council_protocol.sql", "0016_council_hardening.sql", "0018_role_identity_hardening.sql", "0019_council_authority_hardening.sql", "0020_head_role_identity_hardening.sql", "0021_council_round_idempotency.sql", "0027_budget_reservations.sql"];

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

describeDatabase("Budget reservations with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  async function setupResolvedCouncil(departments = ["product"]) {
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
    return { goalId, proof, council: resolved };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS budget_forecasts, budget_reservations, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    for (const name of migrations) {
      const sql = await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8");
      await pool.query(sql);
    }
  });
  beforeEach(async () => { await pool.query("TRUNCATE budget_forecasts, budget_reservations, council_protocol_events, head_councils, goal_head_participations, task_contracts, evidence_records, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls RESTART IDENTITY CASCADE"); await bootstrapPermanentOrganization(pool); });
  afterAll(async () => { await pool.end(); });

  it("reserves a Goal envelope, then a Department allocation within the quality/recovery-protected ceiling", async () => {
    const { goalId, council, proof } = await setupResolvedCouncil();
    const goalReservation = await reserveGoalBudget(pool, goalId, 100_000, "initial envelope", proof, context("secretary"));
    expect(goalReservation.ceoApproved).toBe(false);
    const deptReservation = await reserveDepartmentBudget(pool, council.councilId, "product", 90_000, "product allocation", proof, headContext("product"));
    expect(deptReservation.parentReservationId).toBe(goalReservation.reservationId);
    await expect(reserveDepartmentBudget(pool, council.councilId, "product", 1, "over the reserve", proof, headContext("product"))).rejects.toBeInstanceOf(BudgetReservationError);
  });

  it("requires CEO approval to increase the Goal envelope but not to decrease it", async () => {
    const { goalId, proof } = await setupResolvedCouncil();
    await reserveGoalBudget(pool, goalId, 100_000, "initial envelope", proof, context("secretary"));
    await expect(reserveGoalBudget(pool, goalId, 150_000, "scope grew", proof, context("secretary"))).rejects.toBeInstanceOf(BudgetReservationError);
    const approved = await reserveGoalBudget(pool, goalId, 150_000, "scope grew, approved", proof, context("secretary"), true);
    expect(approved.ceoApproved).toBe(true);
    const decreased = await reserveGoalBudget(pool, goalId, 50_000, "scope shrank", proof, context("secretary"));
    expect(decreased.ceoApproved).toBe(false);
  });

  it("reserves a Mission allocation within the Department's remaining budget, authorized only for the captured Head", async () => {
    const { goalId, council, proof } = await setupResolvedCouncil();
    await reserveGoalBudget(pool, goalId, 100_000, "initial envelope", proof, context("secretary"));
    await reserveDepartmentBudget(pool, council.councilId, "product", 50_000, "product allocation", proof, headContext("product"));
    const missionReservation = await reserveMissionBudget(pool, council.councilId, "product", 1, "scout-1", 20_000, "scout mission", proof, headContext("product"));
    expect(missionReservation.itemId).toBe("scout-1");
    await expect(reserveMissionBudget(pool, council.councilId, "product", 1, "scout-1", 40_000, "over budget", proof, headContext("product"))).rejects.toBeInstanceOf(BudgetReservationError);
    await expect(reserveMissionBudget(pool, council.councilId, "product", 1, "scout-2", 1, "unauthorized", proof, context("not-the-head"))).rejects.toBeInstanceOf(BudgetReservationError);
  });

  it("records and lists milestone forecasts against a reservation, and rejects tampering with append-only reservations", async () => {
    const { goalId, proof } = await setupResolvedCouncil();
    const goalReservation = await reserveGoalBudget(pool, goalId, 100_000, "initial envelope", proof, context("secretary"));
    const forecast = await recordBudgetForecast(pool, goalReservation.reservationId, "milestone 1", 40_000, "medium", context("secretary"));
    expect(forecast.milestone).toBe("milestone 1");
    const listed = await listBudgetForecasts(pool, goalReservation.reservationId);
    expect(listed.length).toBe(1);
    await expect(pool.query("UPDATE budget_reservations SET amount_cents = 1 WHERE reservation_id = $1", [goalReservation.reservationId])).rejects.toThrow();
  });

  it("throws BudgetReservationNotFoundError for a missing reservation", async () => {
    await expect(readBudgetReservation(pool, randomUUID())).rejects.toBeInstanceOf(BudgetReservationNotFoundError);
  });
});
