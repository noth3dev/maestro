import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import {
  appendCapabilityJournal,
  createCapabilityApproval,
  consumeCapabilityApproval,
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
    await pool.query("TRUNCATE capability_decision_journal, capability_repetition_claims, capability_repetition_budgets, capability_sessions, capability_approvals CASCADE");
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

  it("cannot consume two repetition units for one command identity", async () => {
    const created = await createCapabilityApproval(pool, approval({ repetitionScope: { kind: "bounded_count", count: 2 } }));
    const commandId = randomUUID();
    const input = { approvalId: created.approvalId, capabilityKind: "ipython", projectId, goalId: goalA, commandId, action: "project.file.edit", target: "/workspace/a.txt", policyVersion: 1, controlEpoch: "1", budgetEffectCents: 10 };
    await expect(consumeCapabilityApproval(pool, input)).resolves.toMatchObject({ consumed: true, remainingCount: 1 });
    await expect(consumeCapabilityApproval(pool, input)).resolves.toMatchObject({ consumed: false, remainingCount: 1 });
    await expect(pool.query("SELECT count(*)::int AS count FROM capability_repetition_claims WHERE approval_id = $1", [created.approvalId])).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});
