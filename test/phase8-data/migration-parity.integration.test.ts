import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../packages/persistence/src/index.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Plan 8 §S4 production migration parity", () => {
  const schema = `phase8_s4_migration_parity_${randomUUID().replaceAll("-", "")}`;
  const basePool = new Pool({ connectionString: databaseUrl });
  const pool = new Pool({ connectionString: (() => {
    const url = new URL(databaseUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    return url.toString();
  })() });

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA "${schema}"`);
  });

  afterAll(async () => {
    await pool.end();
    await basePool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await basePool.end();
  });

  it("applies migration 0104 through the production runner and preserves its audit boundary", async () => {
    const first = await runMigrations(pool);
    expect(first.applied).toContain("0104_authority_audit_privacy.sql");

    const triggers = await pool.query<{ tgname: string }>(
      `SELECT tgname
         FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid IN ('authority_records'::regclass, 'authority_decisions'::regclass)`,
    );
    expect(triggers.rows.map(({ tgname }) => tgname)).toEqual(expect.arrayContaining([
      "authority_records_sensitive_content",
      "authority_decisions_sensitive_content",
    ]));

    const projectId = randomUUID();
    const goalId = randomUUID();
    const commandId = randomUUID();
    const safeTarget = "remote://example.test/deploy";
    const secret = `phase8-parity-secret-${randomUUID()}`;
    const bearerTarget = `remote-send Authorization: Bearer ${secret}`;

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
      [randomUUID(), commandId, projectId, goalId, bearerTarget],
    )).rejects.toThrow(/private|sensitive|audit|credential/i);

    await expect(pool.query(
      `INSERT INTO authority_decisions
        (decision_id, command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents, outcome, reason, classification, decided_at)
       VALUES ($1, $2, $3, $4, 'operator', 'remote_send', $5, 1, 0, 'deny', $6, 'critical', transaction_timestamp())`,
      [randomUUID(), commandId, projectId, goalId, safeTarget, "ordinary policy refusal"],
    )).resolves.toMatchObject({ rowCount: 1 });

    await expect(pool.query(
      `INSERT INTO authority_decisions
        (decision_id, command_id, project_id, goal_id, actor_id, action, target, policy_version, budget_effect_cents, outcome, reason, classification, decided_at)
       VALUES ($1, $2, $3, $4, 'operator', 'remote_send', $5, 1, 0, 'deny', $6, 'critical', transaction_timestamp())`,
      [randomUUID(), commandId, projectId, goalId, safeTarget, `rejected bearer ${secret}`],
    )).rejects.toThrow(/private|sensitive|audit|credential/i);

    const second = await runMigrations(pool);
    expect(second.applied).toEqual([]);
  });
});
