import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const expectedTables = [
  "concertmaster_final_reports", "evidence_bundles", "certification_conflict_resolutions", "certification_waivers", "conditional_certifications",
  "quality_certifications", "certification_conflict_resolution_members", "department_acceptances", "goal_integration_revision_commits", "goal_integration_revisions",
  "encore_council_syntheses", "encore_council_judgments", "encore_council_rounds", "semantic_reviews", "metronome_challenge_findings",
  "metronome_challenges", "metronome_findings", "budget_forecasts", "budget_reservations", "integration_commits", "worker_worktrees", "goal_integration_branches",
  "team_lead_grants", "workers", "mission_bundles", "department_branches", "department_plan_revisions", "department_plans", "council_protocol_events", "council_round_contributions",
  "council_rounds", "independent_briefs", "council_participants", "head_councils", "goal_head_participations", "task_contract_confirmations",
  "task_contract_decisions", "task_contracts", "permanent_head_roles", "role_persona_axes", "permanent_roles", "departments", "organization_groups",
  "reconciler_leader_lease", "goal_controls", "authority_decisions", "authority_records", "local_operator_credentials", "local_operators", "goal_leases",
  "outbox", "goal_events", "command_receipts", "goals", "head_activation_edges", "head_activation_attempts", "evidence_records",
];

describeDatabase("shared PostgreSQL migration runner", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    await applyAllMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates every durable table from the migration set on a fresh database", async () => {
    const result = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const actualTables = result.rows.map(({ table_name }) => table_name);

    expect(actualTables).toEqual(expect.arrayContaining(expectedTables));
  });

  it("resets the active search-path schema before applying migrations", async () => {
    const schema = `migration_runner_${randomUUID().replaceAll("-", "")}`;
    const scopedUrl = new URL(databaseUrl!);
    scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
    const scopedPool = new Pool({ connectionString: scopedUrl.toString() });

    await pool.query(`CREATE SCHEMA "${schema}"`);
    try {
      await scopedPool.query("CREATE TABLE stale_marker (id integer NOT NULL)");
      await applyAllMigrations(scopedPool);

      const activeSchema = await scopedPool.query<{ schema_name: string }>("SELECT current_schema() AS schema_name");
      expect(activeSchema.rows[0]!.schema_name).toBe(schema);
      const staleMarker = await scopedPool.query("SELECT to_regclass('stale_marker') AS marker");
      expect(staleMarker.rows[0]!.marker).toBeNull();
      await expect(scopedPool.query("SELECT 1 FROM goals LIMIT 0")).resolves.toMatchObject({ rowCount: 0 });
    } finally {
      await scopedPool.end();
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      // The current implementation resets public even when the pool's active
      // schema is custom. Restore it so this focused fixture remains isolated.
      await applyAllMigrations(pool);
    }
  });
});
