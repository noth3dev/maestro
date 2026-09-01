import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapPermanentOrganization } from "./organization.js";
import { acquireGoalLease } from "./commands.js";
import { HeadActivationCycleError, activateHeadParticipation, markHeadParticipationActive, sleepHeadParticipation, type ActivateHeadRequest } from "./head-participation.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = [
  "0001_phase1_core.sql", "0002_goal_leases.sql", "0003_local_operator_auth.sql", "0004_local_operator_credential_security.sql",
  "0005_authority_records.sql", "0006_evidence.sql", "0007_goal_control.sql", "0008_goal_pause_stop.sql",
  "0009_reconciliation_leader_lease.sql", "0010_permanent_organization.sql", "0011_task_contracts.sql", "0012_goal_head_participations.sql",
  "0014_head_activation_runtime_safety.sql", "0018_role_identity_hardening.sql",
];

describeDatabase("Goal Head participation with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  async function goal() {
    const goalId = randomUUID();
    await pool.query(`INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, transaction_timestamp(), transaction_timestamp())`, [goalId, randomUUID()]);
    return goalId;
  }
  async function proof(goalId: string) { return acquireGoalLease(pool, { goalId, ownerId: "control", leaseDurationMs: 60_000 }); }
  const activationBrief = {
    requestedContribution: "needed",
    urgency: "normal",
    contextScope: ["goal"] as const,
    budgetEffect: "none",
  };
  const sane = (goalId: string, departmentId: string) => ({
    goalId, departmentId, reason: "needed", requester: { role: "Sane" as const }, ...activationBrief,
  });
  async function active(goalId: string, departmentId: string) {
    const lease = await proof(goalId);
    await activateHeadParticipation(pool, sane(goalId, departmentId), lease);
    await markHeadParticipationActive(pool, goalId, departmentId, `opaque:${departmentId}`, lease);
    return lease;
  }

  beforeAll(async () => {
    await pool.query("DROP TABLE IF EXISTS head_activation_edges, head_activation_attempts, goal_head_participations, task_contract_confirmations, task_contract_decisions, task_contracts, role_persona_axes, permanent_roles, departments, organization_groups, goal_leases, outbox, goal_events, command_receipts, goals CASCADE");
    for (const name of migrations) await pool.query(await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8"));
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE head_activation_edges, head_activation_attempts, goal_head_participations, goal_leases, outbox, goal_events, command_receipts, goals RESTART IDENTITY CASCADE");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("gives only the selected Product Head minimal Goal participation context", async () => {
    const goalId = await goal(); const lease = await proof(goalId);
    await expect(activateHeadParticipation(pool, sane(goalId, "product"), lease)).resolves.toMatchObject({ goalId, departmentId: "product", status: "starting", activeSessionRef: null });
    const rows = await pool.query("SELECT department_id, status, active_session_ref FROM goal_head_participations WHERE goal_id = $1", [goalId]);
    expect(rows.rows).toEqual([{ department_id: "product", status: "starting", active_session_ref: null }]);
    expect((await pool.query("SELECT department_id, status FROM departments ORDER BY department_id")).rows).toHaveLength(10);
    expect((await pool.query("SELECT status FROM departments")).rows.every((r) => r.status === "sleeping")).toBe(true);
  });

  it("uses one reservation for sequential and concurrent duplicate activation", async () => {
    const goalId = await goal(); const lease = await proof(goalId);
    await activateHeadParticipation(pool, sane(goalId, "product"), lease);
    await expect(activateHeadParticipation(pool, sane(goalId, "product"), lease)).resolves.toMatchObject({ status: "starting" });
    await Promise.all([activateHeadParticipation(pool, sane(goalId, "product"), lease), activateHeadParticipation(pool, sane(goalId, "product"), lease)]);
    expect((await pool.query("SELECT count(*)::int AS count FROM goal_head_participations WHERE goal_id = $1", [goalId])).rows[0].count).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM head_activation_attempts WHERE goal_id = $1", [goalId])).rows[0].count).toBe(4);
  });

  it("rejects B -> A when A -> B already exists and records only the accepted edge", async () => {
    const goalId = await goal(); const lease = await active(goalId, "product");
    await activateHeadParticipation(pool, { goalId, departmentId: "design", reason: "design dependency", requester: { role: "Head", departmentId: "product" }, ...activationBrief }, lease);
    await markHeadParticipationActive(pool, goalId, "design", "opaque:design", lease);
    await expect(activateHeadParticipation(pool, { goalId, departmentId: "product", reason: "loop", requester: { role: "Head", departmentId: "design" }, ...activationBrief }, lease)).rejects.toBeInstanceOf(HeadActivationCycleError);
    expect((await pool.query("SELECT requester_department_id, department_id FROM head_activation_edges WHERE goal_id = $1", [goalId])).rows).toEqual([{ requester_department_id: "product", department_id: "design" }]);
    expect((await pool.query("SELECT outcome FROM head_activation_attempts WHERE goal_id = $1 ORDER BY recorded_at DESC LIMIT 1", [goalId])).rows[0].outcome).toBe("cycle_rejected");
  });

  it("records a self-edge rejection durably without creating an edge", async () => {
    const goalId = await goal(); const lease = await active(goalId, "product");
    await expect(activateHeadParticipation(pool, {
      goalId, departmentId: "product", reason: "self dependency", ...activationBrief,
      requester: { role: "Head", departmentId: "product" },
    }, lease)).rejects.toBeInstanceOf(HeadActivationCycleError);
    expect((await pool.query("SELECT requester_department_id, department_id FROM head_activation_edges WHERE goal_id = $1", [goalId])).rows).toEqual([]);
    expect((await pool.query("SELECT outcome FROM head_activation_attempts WHERE goal_id = $1 ORDER BY recorded_at DESC LIMIT 1", [goalId])).rows[0].outcome).toBe("cycle_rejected");
  });

  it("rejects a transitive cycle by walking from the requested target to its requester", async () => {
    const goalId = await goal(); const lease = await active(goalId, "product");
    await activateHeadParticipation(pool, { goalId, departmentId: "design", reason: "design dependency", requester: { role: "Head", departmentId: "product" }, ...activationBrief }, lease);
    await markHeadParticipationActive(pool, goalId, "design", "opaque:design", lease);
    await activateHeadParticipation(pool, { goalId, departmentId: "engineering", reason: "engineering dependency", requester: { role: "Head", departmentId: "design" }, ...activationBrief }, lease);
    await markHeadParticipationActive(pool, goalId, "engineering", "opaque:engineering", lease);

    await expect(activateHeadParticipation(pool, {
      goalId, departmentId: "product", reason: "close the loop", ...activationBrief,
      requester: { role: "Head", departmentId: "engineering" },
    }, lease)).rejects.toBeInstanceOf(HeadActivationCycleError);
    expect((await pool.query("SELECT requester_department_id, department_id FROM head_activation_edges WHERE goal_id = $1 ORDER BY requester_department_id", [goalId])).rows).toEqual([
      { requester_department_id: "design", department_id: "engineering" },
      { requester_department_id: "product", department_id: "design" },
    ]);
    expect((await pool.query("SELECT outcome FROM head_activation_attempts WHERE goal_id = $1 ORDER BY recorded_at DESC LIMIT 1", [goalId])).rows[0].outcome).toBe("cycle_rejected");
  });

  it("binds the participation to one HeadRoleId, contract, and Goal context", async () => {
    const goalId = await goal(); const lease = await proof(goalId);
    const contractId = randomUUID(); const otherContractId = randomUUID(); const contextId = `context:${goalId}`;
    await pool.query(`INSERT INTO task_contracts
      (contract_id, schema_version, version, content, content_hash, launch_state)
      VALUES ($1, 1, 1, '{}'::jsonb, $2, 'launched'),
             ($3, 1, 1, '{}'::jsonb, $2, 'launched')`, [contractId, "0".repeat(64), otherContractId]);

    await expect(activateHeadParticipation(pool, {
      goalId, departmentId: "product", headRoleId: "head:product", contractId, contextId,
      requestedContribution: "review the Product boundary", urgency: "high",
      contextScope: ["goal", "repository"], budgetEffect: "2 credits",
      reason: "bind context", requester: { role: "Sane" },
    }, lease)).resolves.toMatchObject({
      goalId, departmentId: "product", headRoleId: "head:product", contractId, contextId,
      status: "starting", activeSessionRef: null,
    });
    expect((await pool.query(`SELECT requested_contribution, urgency, context_scope, budget_effect
      FROM head_activation_attempts WHERE goal_id = $1 AND outcome = 'reserved'`, [goalId])).rows).toEqual([{
      requested_contribution: "review the Product boundary", urgency: "high",
      context_scope: ["goal", "repository"], budget_effect: "2 credits",
    }]);
    await markHeadParticipationActive(pool, goalId, "product", "opaque:product:bound", lease);

    await expect(activateHeadParticipation(pool, {
      goalId, departmentId: "product", headRoleId: "head:product", contractId, contextId,
      ...activationBrief, reason: "same binding", requester: { role: "Sane" },
    }, lease)).resolves.toMatchObject({
      headRoleId: "head:product", contractId, contextId, status: "active", activeSessionRef: "opaque:product:bound",
    });
    await expect(activateHeadParticipation(pool, {
      goalId, departmentId: "product", headRoleId: "head:product", contractId: otherContractId,
      contextId, ...activationBrief, reason: "different contract", requester: { role: "Sane" },
    }, lease)).rejects.toMatchObject({ code: "head_activation_binding_conflict" });
    await expect(activateHeadParticipation(pool, {
      goalId, departmentId: "product", headRoleId: "head:product", contractId,
      contextId: `context:${goalId}:different`, ...activationBrief, reason: "different context", requester: { role: "Sane" },
    }, lease)).rejects.toMatchObject({ code: "head_activation_binding_conflict" });
    await expect(activateHeadParticipation(pool, {
      goalId, departmentId: "product", headRoleId: "head:design", contractId, contextId,
      ...activationBrief, reason: "wrong role", requester: { role: "Sane" },
    }, lease)).rejects.toMatchObject({ code: "head_activation_binding_conflict" });
  });

  it("rejects every omitted activation brief field before durable state changes", async () => {
    const goalId = await goal(); const lease = await proof(goalId);
    const base = { goalId, departmentId: "product", reason: "missing brief", requester: { role: "Sane" as const } };
    for (const field of ["requestedContribution", "urgency", "contextScope", "budgetEffect"] as const) {
      const incomplete = { ...base, ...activationBrief };
      delete (incomplete as unknown as Record<string, unknown>)[field];
      await expect(activateHeadParticipation(pool, incomplete as unknown as ActivateHeadRequest, lease))
        .rejects.toThrow(`${field} is required`);
    }
    expect((await pool.query(`SELECT count(*)::int AS count FROM head_activation_attempts WHERE goal_id = $1`, [goalId])).rows[0].count).toBe(0);
  });

  it("rejects an empty activation brief field before durable state changes", async () => {
    const goalId = await goal(); const lease = await proof(goalId);
    await expect(activateHeadParticipation(pool, {
      goalId, departmentId: "product", reason: "invalid brief", requester: { role: "Sane" },
      requestedContribution: "", urgency: "normal", contextScope: ["goal"], budgetEffect: "none",
    }, lease)).rejects.toThrow("requestedContribution");
    expect((await pool.query(`SELECT count(*)::int AS count FROM head_activation_attempts WHERE goal_id = $1`, [goalId])).rows[0].count).toBe(0);
  });

  it("keeps Sane activation on the ordinary reservation path", async () => {
    const goalId = await goal(); const lease = await proof(goalId);
    await expect(activateHeadParticipation(pool, sane(goalId, "product"), lease)).resolves.toMatchObject({
      goalId, departmentId: "product", status: "starting", activeSessionRef: null,
    });
    expect((await pool.query("SELECT requester_role, outcome FROM head_activation_attempts WHERE goal_id = $1", [goalId])).rows).toEqual([
      { requester_role: "Sane", outcome: "reserved" },
    ]);
  });

  it("rejects a persistent Head reservation already active in another Goal", async () => {
    const firstGoalId = await goal(); const firstLease = await proof(firstGoalId);
    await activateHeadParticipation(pool, sane(firstGoalId, "product"), firstLease);
    await markHeadParticipationActive(pool, firstGoalId, "product", "opaque:product:first", firstLease);

    const secondGoalId = await goal(); const secondLease = await proof(secondGoalId);
    await expect(activateHeadParticipation(pool, sane(secondGoalId, "product"), secondLease))
      .rejects.toMatchObject({ code: "head_runtime_conflict" });
    expect((await pool.query("SELECT goal_id, department_id, status, active_session_ref FROM goal_head_participations ORDER BY goal_id")).rows).toEqual([
      { goal_id: firstGoalId, department_id: "product", status: "active", active_session_ref: "opaque:product:first" },
    ]);
  });

  it("records a noncyclic duplicate as already_active without another session grant", async () => {
    const goalId = await goal(); const lease = await active(goalId, "product");
    const result = await activateHeadParticipation(pool, sane(goalId, "product"), lease);
    expect(result).toMatchObject({ status: "active", activeSessionRef: "opaque:product" });
    expect((await pool.query("SELECT outcome FROM head_activation_attempts WHERE goal_id = $1 ORDER BY recorded_at DESC LIMIT 1", [goalId])).rows[0].outcome).toBe("already_active");
  });

  it("does not bind one active session reference to two HeadRoleId and Goal pairs", async () => {
    const firstGoalId = await goal(); const firstLease = await proof(firstGoalId);
    await activateHeadParticipation(pool, sane(firstGoalId, "product"), firstLease);
    const secondGoalId = await goal(); const secondLease = await proof(secondGoalId);
    await activateHeadParticipation(pool, sane(secondGoalId, "design"), secondLease);
    await markHeadParticipationActive(pool, firstGoalId, "product", "opaque:shared", firstLease);

    await expect(markHeadParticipationActive(pool, secondGoalId, "design", "opaque:shared", secondLease))
      .rejects.toMatchObject({ code: "head_runtime_conflict" });
    expect((await pool.query(`SELECT goal_id, department_id, active_session_ref
      FROM goal_head_participations WHERE goal_id IN ($1, $2) ORDER BY department_id`, [firstGoalId, secondGoalId])).rows).toEqual([
      { goal_id: secondGoalId, department_id: "design", active_session_ref: null },
      { goal_id: firstGoalId, department_id: "product", active_session_ref: "opaque:shared" },
    ]);
  });

  it("sleeps by clearing the session and resumes the same row", async () => {
    const goalId = await goal(); const lease = await active(goalId, "product");
    await expect(sleepHeadParticipation(pool, goalId, "product", lease)).resolves.toMatchObject({ status: "sleeping", activeSessionRef: null });
    await expect(activateHeadParticipation(pool, sane(goalId, "product"), lease)).resolves.toMatchObject({ status: "starting", activeSessionRef: null });
    expect((await pool.query("SELECT count(*)::int AS count FROM goal_head_participations WHERE goal_id = $1 AND department_id = 'product'", [goalId])).rows[0].count).toBe(1);
  });

  it("rejects a stale proof without creating participation, attempt, or edge state", async () => {
    const goalId = await goal(); const stale = await proof(goalId);
    await pool.query("UPDATE goal_leases SET expires_at = transaction_timestamp() - interval '1 second' WHERE goal_id = $1", [goalId]);
    await proof(goalId);
    await expect(activateHeadParticipation(pool, sane(goalId, "product"), stale)).rejects.toMatchObject({ code: "stale_lease" });
    expect((await pool.query("SELECT (SELECT count(*) FROM goal_head_participations) AS participations, (SELECT count(*) FROM head_activation_attempts) AS attempts, (SELECT count(*) FROM head_activation_edges) AS edges")).rows[0]).toEqual({ participations: "0", attempts: "0", edges: "0" });
  });
});
