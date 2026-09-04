import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskContractContentHash, type DecisionPacket, type IndependentBrief, type TaskContractSubstance } from "@maestro/domain";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease, StaleGoalLeaseError } from "./commands.js";
import { createHeadCouncil, recordCouncilDecisionPacket, revealCouncilBriefs, submitIndependentBrief } from "./council.js";
import { BudgetReservationError, BudgetReservationNotFoundError, listBudgetForecasts, readBudgetReservation, recordBudgetForecast, reserveDepartmentBudget, reserveGoalBudget, reserveMissionBudget } from "./budget-reservation.js";

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

describeDatabase("Budget reservations with PostgreSQL", () => {
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
    return { goalId, proof, council: resolved };
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS budget_forecasts, budget_reservations, council_protocol_events, council_round_contributions, council_rounds, independent_briefs, council_participants, head_councils, head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, permanent_head_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals, goal_controls CASCADE");
    await applyAllMigrations(pool);
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

  it("rejects Department over-allocation across a re-reserved Goal envelope of the same amount, closing the double-counting gap (Phase 2 re-patch item 1)", async () => {
    const { goalId, council, proof } = await setupResolvedCouncil();
    // A routine, CEO-approval-free "same amount" re-reservation: not an
    // increase, so it needs no approval, yet it is still a brand-new
    // append-only goal-scope row with its own reservation_id.
    const firstEnvelope = await reserveGoalBudget(pool, goalId, 100_000, "initial envelope", proof, context("secretary"));
    const firstAllocation = await reserveDepartmentBudget(pool, council.councilId, "product", 80_000, "first allocation", proof, headContext("product"));
    expect(firstAllocation.parentReservationId).toBe(firstEnvelope.reservationId);

    const secondEnvelope = await reserveGoalBudget(pool, goalId, 100_000, "re-reserved, same amount", proof, context("secretary"));
    expect(secondEnvelope.reservationId).not.toBe(firstEnvelope.reservationId);
    expect(secondEnvelope.ceoApproved).toBe(false);

    // Without the fix, this would bind to the new (second) envelope row,
    // whose own direct children sum to 0 so far, and incorrectly succeed --
    // pushing real cumulative Department spend to 160,000 against a 90,000
    // allocatable ceiling (the exact scenario this item's audit reproduced).
    await expect(
      reserveDepartmentBudget(pool, council.councilId, "product", 80_000, "second allocation", proof, headContext("product")),
    ).rejects.toBeInstanceOf(BudgetReservationError);

    // A smaller amount that fits the true remaining allocatable room (90,000 - 80,000 = 10,000) still succeeds.
    const withinRemaining = await reserveDepartmentBudget(pool, council.councilId, "product", 10_000, "fits the true remainder", proof, headContext("product"));
    expect(withinRemaining.parentReservationId).toBe(secondEnvelope.reservationId);
    await expect(
      reserveDepartmentBudget(pool, council.councilId, "product", 1, "one cent over the true remainder", proof, headContext("product")),
    ).rejects.toBeInstanceOf(BudgetReservationError);
  });

  it("rejects Mission over-allocation across a re-reserved Department envelope of the same amount", async () => {
    const { goalId, council, proof } = await setupResolvedCouncil();
    // A large enough Goal envelope that Department-level re-reservations
    // (well within its allocatable ceiling) do not themselves trip the
    // Department-level check exercised by the previous test -- this test
    // isolates the same double-counting fix one level down, at the
    // Department-to-Mission boundary.
    await reserveGoalBudget(pool, goalId, 300_000, "initial envelope", proof, context("secretary"));
    const firstDept = await reserveDepartmentBudget(pool, council.councilId, "product", 50_000, "product allocation", proof, headContext("product"));
    const firstMission = await reserveMissionBudget(pool, council.councilId, "product", 1, "scout-1", 40_000, "first mission allocation", proof, headContext("product"));
    expect(firstMission.parentReservationId).toBe(firstDept.reservationId);

    const secondDept = await reserveDepartmentBudget(pool, council.councilId, "product", 50_000, "re-reserved, same amount", proof, headContext("product"));
    expect(secondDept.reservationId).not.toBe(firstDept.reservationId);

    await expect(
      reserveMissionBudget(pool, council.councilId, "product", 1, "scout-2", 40_000, "second mission allocation", proof, headContext("product")),
    ).rejects.toBeInstanceOf(BudgetReservationError);

    const withinRemaining = await reserveMissionBudget(pool, council.councilId, "product", 1, "scout-2", 10_000, "fits the true remainder", proof, headContext("product"));
    expect(withinRemaining.parentReservationId).toBe(secondDept.reservationId);
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

  it("rejects Department budget allocation for a captured Department the Council did not assign ownership to", async () => {
    const { goalId, council, proof } = await setupResolvedCouncil(["product", "engineering"], ["product"]);
    await reserveGoalBudget(pool, goalId, 100_000, "initial envelope", proof, context("secretary"));
    await expect(reserveDepartmentBudget(pool, council.councilId, "engineering", 1_000, "unowned", proof, headContext("engineering"))).rejects.toBeInstanceOf(BudgetReservationError);
    const owned = await reserveDepartmentBudget(pool, council.councilId, "product", 1_000, "owned", proof, headContext("product"));
    expect(owned.departmentId).toBe("product");
  });

  it("rejects every budget write with a stale fencing token and leaves each reservation scope unchanged", async () => {
    const { goalId, council, proof } = await setupResolvedCouncil();
    const forgedProof = { goalId, ownerId: proof.ownerId, fencingToken: String(BigInt(proof.fencingToken) + 1n) };

    await expect(reserveGoalBudget(pool, goalId, 100_000, "forged goal envelope", forgedProof, context("secretary")))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM budget_reservations WHERE goal_id = $1 AND scope = 'goal'", [goalId])).rows[0]!.count).toBe(0);
    const goalReservation = await reserveGoalBudget(pool, goalId, 100_000, "real goal envelope", proof, context("secretary"));

    await expect(reserveDepartmentBudget(pool, council.councilId, "product", 10_000, "forged department allocation", forgedProof, headContext("product")))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM budget_reservations WHERE goal_id = $1 AND scope = 'department'", [goalId])).rows[0]!.count).toBe(0);
    const departmentReservation = await reserveDepartmentBudget(pool, council.councilId, "product", 10_000, "real department allocation", proof, headContext("product"));

    await expect(reserveMissionBudget(pool, council.councilId, "product", 1, "mission-1", 1_000, "forged mission allocation", forgedProof, headContext("product")))
      .rejects.toBeInstanceOf(StaleGoalLeaseError);
    expect((await pool.query("SELECT count(*)::int AS count FROM budget_reservations WHERE goal_id = $1 AND scope = 'mission'", [goalId])).rows[0]!.count).toBe(0);
    const missionReservation = await reserveMissionBudget(pool, council.councilId, "product", 1, "mission-1", 1_000, "real mission allocation", proof, headContext("product"));
    expect(missionReservation.parentReservationId).toBe(departmentReservation.reservationId);
    expect(departmentReservation.parentReservationId).toBe(goalReservation.reservationId);
  });

  it("throws BudgetReservationNotFoundError for a missing reservation", async () => {
    await expect(readBudgetReservation(pool, randomUUID())).rejects.toBeInstanceOf(BudgetReservationNotFoundError);
  });
});
