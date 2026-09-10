import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { acquireGoalLease, executeGoalCommand, releaseGoalLease } from "./commands.js";
import {
  appendCapabilityJournal,
  createCapabilityApproval,
  consumeCapabilityApproval,
  consumeCapabilityApprovals,
  listPendingCapabilityEffects,
  resolveCapabilityEffect,
  getCapabilitySession,
  setCapabilitySession,
  CapabilityApprovalExpiredError,
  RepetitionBudgetExhaustedError,
  type CapabilityApprovalInput,
} from "./capability-approval.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("capability approval ledger", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  let pool: Pool;
  let schema: string;
  const projectId = randomUUID();
  const goalA = randomUUID();
  const goalB = randomUUID();

  const approval = (overrides: Partial<CapabilityApprovalInput> = {}): CapabilityApprovalInput => ({
    approvalId: randomUUID(),
    capabilityKind: "ipython",
    projectId,
    goalId: goalA,
    commandId: randomUUID(),
    action: "project.file.edit",
    target: "/workspace/a.txt",
    policyVersion: 1,
    controlEpoch: "1",
    budgetEffectCents: 10,
    tier: "Department Head",
    approverId: "head-1",
    decision: "approved",
    reason: "The action is required for the approved Goal outcome.",
    consequence: "The bounded effect may change the project state within the recorded scope.",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    repetitionScope: { kind: "bounded_count", count: 2 },
    ...overrides,
  });

  beforeAll(async () => {
    schema = `capability_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await basePool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    pool = new Pool({ connectionString: url.toString() });
    await applyAllMigrations(pool);
    await pool.query(
      `INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at)
       VALUES ($1, $3, 'active', 1, transaction_timestamp(), transaction_timestamp()),
              ($2, $3, 'active', 1, transaction_timestamp(), transaction_timestamp())`,
      [goalA, goalB, projectId],
    );
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE capability_effect_resolutions, capability_decision_journal, capability_repetition_claims, capability_repetition_budgets, capability_sessions, capability_approvals CASCADE");
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("does not authorize a different action target", async () => {
    const created = await createCapabilityApproval(pool, approval());
    await expect(consumeCapabilityApproval(pool, {
      approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA,
      commandId: randomUUID(), action: "project.file.edit", target: "/workspace/other.txt",
      policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10,
    })).rejects.toThrow("exact capability identity");
  });

  it("evaluates expiry on the server", async () => {
    const created = await createCapabilityApproval(pool, approval({ expiresAt: new Date("2000-01-01T00:00:00Z") }));
    await expect(consumeCapabilityApproval(pool, {
      approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA,
      commandId: randomUUID(), action: "project.file.edit", target: "/workspace/a.txt",
      policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10,
    })).rejects.toBeInstanceOf(CapabilityApprovalExpiredError);
  });

  it("decrements repetition scope exactly once and rejects zero", async () => {
    const created = await createCapabilityApproval(pool, approval({ repetitionScope: { kind: "bounded_count", count: 1 } }));
    const commandId = randomUUID();
    await expect(consumeCapabilityApproval(pool, {
      approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId,
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10,
    })).resolves.toMatchObject({ consumed: true, remainingCount: 0 });
    await expect(consumeCapabilityApproval(pool, {
      approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId: randomUUID(),
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10,
    })).rejects.toBeInstanceOf(RepetitionBudgetExhaustedError);
  });

  it("isolates approvals and full-access sessions by Goal", async () => {
    const sessionId = randomUUID();
    await setCapabilitySession(pool, { sessionId, capabilityKind: "ipython", projectId, goalId: goalA, fullAccessMode: "skip_intermediate_approvals", selectedBy: "user-1" });
    expect(await getCapabilitySession(pool, "ipython", projectId, goalA)).toMatchObject({ goalId: goalA, fullAccessMode: "skip_intermediate_approvals" });
    expect(await getCapabilitySession(pool, "ipython", projectId, goalB)).toBeUndefined();
    const created = await createCapabilityApproval(pool, approval());
    await expect(consumeCapabilityApproval(pool, {
      approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalB, commandId: randomUUID(),
      action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10,
    })).rejects.toThrow("Goal-scoped");
  });

  it("rejects journal UPDATE and DELETE at the database level", async () => {
    const entry = await appendCapabilityJournal(pool, {
      capabilityKind: "ipython", projectId, goalId: goalA, commandId: randomUUID(),
      event: "rejection", details: { reason: "test" },
    });
    await expect(pool.query("UPDATE capability_decision_journal SET details = '{}' WHERE journal_id = $1", [entry.journalId])).rejects.toThrow("append-only");
    await expect(pool.query("DELETE FROM capability_decision_journal WHERE journal_id = $1", [entry.journalId])).rejects.toThrow("append-only");
  });

  it("consumes a multi-effect block atomically and scopes claims by effect index", async () => {
    const approvalCommandId = randomUUID();
    const first = await createCapabilityApproval(pool, approval({ commandId: approvalCommandId, target: "/workspace/a.txt", repetitionScope: { kind: "bounded_count", count: 1 } }));
    const second = await createCapabilityApproval(pool, approval({ commandId: approvalCommandId, target: "/workspace/b.txt", repetitionScope: { kind: "bounded_count", count: 1 }, expiresAt: new Date("2000-01-01T00:00:00Z") }));
    const commandId = randomUUID();
    const inputs = [
      { approvalId: first.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, effectIndex: 0, action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 },
      { approvalId: second.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, effectIndex: 1, action: "project.file.edit", target: "/workspace/b.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 },
    ] as const;
    await expect(consumeCapabilityApprovals(pool, inputs)).rejects.toBeInstanceOf(CapabilityApprovalExpiredError);
    await expect(pool.query("SELECT remaining_count FROM capability_repetition_budgets WHERE approval_id = $1", [first.approvalId])).resolves.toMatchObject({ rows: [{ remaining_count: "1" }] });
    await expect(pool.query("SELECT count(*)::int AS count FROM capability_repetition_claims WHERE command_id = $1", [commandId])).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("lists and explicitly resolves a pending effect before releasing its repetition budget", async () => {
    const created = await createCapabilityApproval(pool, approval({ repetitionScope: { kind: "bounded_count", count: 1 } }));
    const commandId = randomUUID();
    const admissionCommandId = randomUUID();
    const consumed = await consumeCapabilityApproval(pool, { approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, admissionCommandId, action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 });
    const claim = (await pool.query<{ claim_id: string }>("SELECT claim_id FROM capability_repetition_claims WHERE approval_id = $1", [created.approvalId])).rows[0]!;
    await expect(listPendingCapabilityEffects(pool, "ipython", projectId, goalA)).resolves.toEqual([{ commandId, effectIndex: 0, admissionCommandId }]);
    await expect(pool.query("SELECT details->>'remainingCount' AS remaining_count, details->>'remainingBudgetCents' AS remaining_budget, details->>'repetitionExpiresAt' AS repetition_expires_at, details->>'admissionCommandId' AS admission_command_id FROM capability_decision_journal WHERE approval_id = $1 AND command_id = $2 AND event = 'effect_result' ORDER BY recorded_at ASC LIMIT 1", [created.approvalId, commandId])).resolves.toMatchObject({ rows: [{ remaining_count: "0", remaining_budget: null, repetition_expires_at: null, admission_command_id: admissionCommandId }] });
    await expect(resolveCapabilityEffect(pool, { claimId: claim.claim_id, approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, effectIndex: 0, outcome: "aborted", resolvedBy: "operator-1", reason: "provider audit proves the write was not issued" })).resolves.toMatchObject({ outcome: "aborted", commandId, effectIndex: 0 });
    await expect(listPendingCapabilityEffects(pool, "ipython", projectId, goalA)).resolves.toEqual([]);
    await expect(pool.query("SELECT remaining_count FROM capability_repetition_budgets WHERE approval_id = $1", [created.approvalId])).resolves.toMatchObject({ rows: [{ remaining_count: "1" }] });
    await expect(resolveCapabilityEffect(pool, { claimId: claim.claim_id, approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, effectIndex: 0, outcome: "aborted", resolvedBy: "operator-1", reason: "provider audit proves the write was not issued" })).resolves.toMatchObject({ outcome: "aborted" });
    expect(consumed.consumed).toBe(true);
  });

  it("allows one approval to cover distinct effects in one atomic block", async () => {
    const created = await createCapabilityApproval(pool, approval({ repetitionScope: { kind: "bounded_count", count: 2 } }));
    const commandId = randomUUID();
    const inputs = [
      { approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, effectIndex: 0, action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 },
      { approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, effectIndex: 1, action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 },
    ] as const;
    await expect(consumeCapabilityApprovals(pool, inputs)).resolves.toEqual([
      expect.objectContaining({ consumed: true, remainingCount: 1 }),
      expect.objectContaining({ consumed: true, remainingCount: 0 }),
    ]);
    await expect(pool.query("SELECT effect_index FROM capability_repetition_claims WHERE approval_id = $1 ORDER BY effect_index", [created.approvalId])).resolves.toMatchObject({ rows: [{ effect_index: 0 }, { effect_index: 1 }] });
  });

  it("rolls back a partially replayed effect block instead of consuming fresh budget", async () => {
    const created = await createCapabilityApproval(pool, approval({ repetitionScope: { kind: "bounded_count", count: 2 } }));
    const commandId = randomUUID();
    const input = (effectIndex: number) => ({ approvalId: created.approvalId, capabilityKind: "ipython" as const, projectId, goalId: goalA, commandId, effectIndex, action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 });
    await expect(consumeCapabilityApproval(pool, input(0))).resolves.toMatchObject({ consumed: true, remainingCount: 1 });
    await expect(consumeCapabilityApprovals(pool, [input(0), input(1)] as const)).rejects.toThrow("partially consumed");
    await expect(pool.query("SELECT count(*)::int AS count FROM capability_repetition_claims WHERE approval_id = $1", [created.approvalId])).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(pool.query("SELECT remaining_count FROM capability_repetition_budgets WHERE approval_id = $1", [created.approvalId])).resolves.toMatchObject({ rows: [{ remaining_count: "1" }] });
  });

  it("keeps a Goal in recovery while a pending effect has no terminal evidence", async () => {
    const created = await createCapabilityApproval(pool, approval({ repetitionScope: { kind: "bounded_count", count: 1 } }));
    const commandId = randomUUID();
    await consumeCapabilityApproval(pool, { approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 });
    const claim = (await pool.query<{ claim_id: string }>("SELECT claim_id FROM capability_repetition_claims WHERE approval_id = $1", [created.approvalId])).rows[0]!;
    const proof = await acquireGoalLease(pool, { goalId: goalA, ownerId: "recovery-test", leaseDurationMs: 60_000 });
    const recovering = await executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId: goalA, actorId: "recovery-test", type: "TransitionGoal", expectedVersion: 1, to: "recovering" }, proof);
    expect(recovering.outcome).toBe("succeeded");
    await expect(executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId: goalA, actorId: "recovery-test", type: "TransitionGoal", expectedVersion: 2, to: "active" }, proof)).resolves.toMatchObject({ outcome: "rejected", code: "invalid_transition" });
    await expect(resolveCapabilityEffect(pool, { claimId: claim.claim_id, approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, effectIndex: 0, outcome: "confirmed", resolvedBy: "operator-1", reason: "external audit confirms the effect was applied" })).resolves.toMatchObject({ outcome: "confirmed" });
    await expect(executeGoalCommand(pool, { commandId: randomUUID(), projectId, goalId: goalA, actorId: "recovery-test", type: "TransitionGoal", expectedVersion: 2, to: "active" }, proof)).resolves.toMatchObject({ outcome: "succeeded", state: "active" });
    await releaseGoalLease(pool, proof);
  });

  it("cannot consume two repetition units for one command identity", async () => {
    const created = await createCapabilityApproval(pool, approval({ repetitionScope: { kind: "bounded_count", count: 2 } }));
    const commandId = randomUUID();
    const input = { approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 };
    await expect(consumeCapabilityApproval(pool, input)).resolves.toMatchObject({ consumed: true, remainingCount: 1 });
    await expect(consumeCapabilityApproval(pool, input)).resolves.toMatchObject({ consumed: false, remainingCount: 1 });
    await expect(pool.query("SELECT count(*)::int AS count FROM capability_repetition_claims WHERE approval_id = $1", [created.approvalId])).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(pool.query("SELECT details->>'outcome' AS outcome FROM capability_decision_journal WHERE approval_id = $1 AND command_id = $2 AND event = 'effect_result' ORDER BY recorded_at ASC LIMIT 1", [created.approvalId, commandId])).resolves.toMatchObject({ rows: [{ outcome: "pending_unknown" }] });
  });
});
