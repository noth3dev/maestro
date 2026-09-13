import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONCERTMASTER_PERSONA_BASELINE, PERSONA_AXES, type LearnedPersonaProfileVersionInput, type TaskClassPersonaAdjustmentInput } from "@maestro/domain";
import { applyAllMigrations } from "./test-migrations.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { listLearnedPersonaProfileVersions, readActivePersonaProfile, storeLearnedPersonaProfileVersion, storeTaskClassPersonaAdjustment } from "./persona-profile.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("learned persona profile persistence", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `persona_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = (() => { const url = new URL(databaseUrl!); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })();
  let pool: Pool;
  beforeAll(async () => { await basePool.query(`CREATE SCHEMA ${schema}`); pool = new Pool({ connectionString: scopedUrl }); await applyAllMigrations(pool); await bootstrapPermanentOrganization(pool); });
  beforeEach(async () => {
    await pool.query("TRUNCATE persona_task_class_adjustments, persona_profile_versions");
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  const rationale = () => Object.fromEntries(PERSONA_AXES.map((axis) => [axis, { reason: "approved duty rubric", low: "less", current: "balanced", high: "more" }]));
  const profile = (version: number): LearnedPersonaProfileVersionInput => ({ roleId: "concertmaster", version, profile: CONCERTMASTER_PERSONA_BASELINE, rationale: rationale(), source: "phase-2-approved-seed" });

  it("versions learned profiles and retains each version's rationale", async () => {
    await storeLearnedPersonaProfileVersion(pool, { ...profile(2), profile: { ...CONCERTMASTER_PERSONA_BASELINE, caution: 0.92 } });
    await expect(listLearnedPersonaProfileVersions(pool, "concertmaster")).resolves.toHaveLength(2);
    await expect(readActivePersonaProfile(pool, "concertmaster", "incident-triage")).resolves.toMatchObject({ layers: { learnedProfile: { version: 2, rationale: rationale() } } });
  });

  it("stores task-class deltas separately and composes them without mutating the baseline", async () => {
    const adjustment: TaskClassPersonaAdjustmentInput = { roleId: "concertmaster", taskClass: "incident-triage", version: 1, delta: { caution: 0.04 }, reason: "incident evidence" };
    await storeTaskClassPersonaAdjustment(pool, adjustment);
    const active = await readActivePersonaProfile(pool, "concertmaster", "incident-triage");
    expect(active.persona.caution).toBeCloseTo(0.94);
    expect(active.layers.taskClassAdjustment).toMatchObject(adjustment);
    expect((await listLearnedPersonaProfileVersions(pool, "concertmaster"))[0]!.profile.caution).toBe(0.90);
  });

  it("does not expose adaptive writes for permanent role core identity", async () => {
    const before = await pool.query("SELECT role_charter, capability_boundary, provenance FROM permanent_roles WHERE role_id = 'concertmaster'");
    await storeLearnedPersonaProfileVersion(pool, { ...profile(2), profile: { ...CONCERTMASTER_PERSONA_BASELINE, caution: 0.92 } });
    await storeTaskClassPersonaAdjustment(pool, { roleId: "concertmaster", taskClass: "product-discovery", version: 1, delta: { imagination: 0.03 }, reason: "discovery evidence" });
    const columns = await pool.query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('permanent_roles', 'persona_profile_versions', 'persona_task_class_adjustments') ORDER BY table_name, column_name`, [schema]);
    expect(columns.rows.filter((row) => row.table_name !== "permanent_roles").map((row) => row.column_name)).not.toContain("role_charter");
    await expect(pool.query("SELECT role_charter, capability_boundary, provenance FROM permanent_roles WHERE role_id = 'concertmaster'")).resolves.toMatchObject({ rows: before.rows });
  });

  it("enforces append-only history and durable JSON shape at the database boundary", async () => {
    await storeTaskClassPersonaAdjustment(pool, { roleId: "concertmaster", taskClass: "incident-triage", version: 1, delta: { caution: 0.03 }, reason: "incident evidence" });
    await expect(pool.query("UPDATE persona_profile_versions SET source = 'tampered' WHERE role_id = 'concertmaster' AND version = 1")).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM persona_task_class_adjustments WHERE role_id = 'concertmaster' AND task_class = 'incident-triage' AND version = 1")).rejects.toThrow(/append-only/);
    await expect(pool.query(`INSERT INTO persona_profile_versions (role_id, version, profile, rationale, source) VALUES ('concertmaster', 99, '{}'::jsonb, '{}'::jsonb, 'bad')`)).rejects.toThrow();
    await expect(pool.query(`INSERT INTO persona_task_class_adjustments (role_id, task_class, version, delta, reason) VALUES ('concertmaster', 'bad-shape', 99, '{"caution": 0.1, "realism": 0.1, "initiative": 0.1}'::jsonb, 'bad')`)).rejects.toThrow();
  });
});
