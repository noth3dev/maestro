import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "@maestro/persistence";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Plan 8 §S4 audit-record privacy", () => {
  const schema = `phase8_s4_audit_privacy_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const pool = new Pool({ connectionString: (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })() });

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    await applyAllMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA ${schema} CASCADE`);
    await basePool.end();
  });

  it("rejects raw bearer credentials before they enter authority audit records", async () => {
    const projectId = randomUUID();
    const goalId = randomUUID();
    const commandId = randomUUID();
    const secret = `phase8-audit-secret-${randomUUID()}`;
    const target = `remote-send Authorization: Bearer ${secret}`;
    const safeTarget = "remote://example.test/deploy";

    await expect(pool.query(
      `INSERT INTO authority_records
        (record_id, kind, command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents, expires_at)
       VALUES ($1, 'approval', $2, $3, $4, 'operator', 'remote_send', $5, 1, 0, transaction_timestamp() + interval '1 hour')`,
      [randomUUID(), commandId, projectId, goalId, safeTarget],
    )).resolves.toMatchObject({ rowCount: 1 });

    await expect(pool.query(
      `INSERT INTO authority_records
        (record_id, kind, command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents, expires_at)
       VALUES ($1, 'approval', $2, $3, $4, 'operator', 'remote_send', $5, 1, 0, transaction_timestamp() + interval '1 hour')`,
      [randomUUID(), commandId, projectId, goalId, target],
    )).rejects.toThrow(/credential|secret|private|audit|sensitive/i);

    await expect(pool.query("SELECT count(*)::int AS count FROM authority_records WHERE target = $1", [target]))
      .resolves.toMatchObject({ rows: [{ count: 0 }] });

    await expect(pool.query(
      `INSERT INTO authority_decisions
        (decision_id, command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents, outcome, reason, classification, decided_at)
       VALUES ($1, $2, $3, $4, 'operator', 'remote_send', $5, 1, 0, 'deny', $6, 'critical', transaction_timestamp())`,
      [randomUUID(), commandId, projectId, goalId, target, `operator rejected bearer ${secret}`],
    )).rejects.toThrow(/credential|secret|private|audit|sensitive/i);

    await expect(pool.query("SELECT count(*)::int AS count FROM authority_decisions WHERE target = $1", [target]))
      .resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
});
