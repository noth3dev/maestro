import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-migrations.js";
import { bootstrapPermanentOrganization } from "./organization.js";
import { grantProjectMembership, grantProjectRole } from "./project-membership.js";
import { createProject, ensureHomeProject, InvalidProjectNameError, listProjectCatalog, ProjectNotFoundError, renameProject } from "./project-catalog.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Project catalog with PostgreSQL", () => {
  const basePool = new Pool({ connectionString: databaseUrl });
  const schema = `project_catalog_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = databaseUrl ? (() => { const url = new URL(databaseUrl); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); })() : "";
  let pool: Pool;

  beforeAll(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: scopedUrl });
    await applyAllMigrations(pool);
    await bootstrapPermanentOrganization(pool);
  });
  afterAll(async () => { await pool.end(); await basePool.query(`DROP SCHEMA ${schema} CASCADE`); await basePool.end(); });

  async function operator() {
    const operatorId = randomUUID();
    await pool.query("INSERT INTO local_operators (operator_id) VALUES ($1)", [operatorId]);
    const home = randomUUID();
    await grantProjectMembership(pool, operatorId, home);
    await grantProjectRole(pool, operatorId, home, "concertmaster");
    await ensureHomeProject(pool, operatorId, home);
    await ensureHomeProject(pool, operatorId, randomUUID());
    return { operatorId, home };
  }

  it("lists Home first, creates projects with the Home roles, and renames them", async () => {
    const { operatorId, home } = await operator();
    const other = await operator();
    const commandId = randomUUID();
    const created = await createProject(pool, { operatorId, name: "  Newsletter   site ", commandId });
    expect(created).toMatchObject({ name: "Newsletter site", kind: "project", goalCount: 0, activeGoalCount: 0 });
    expect((await createProject(pool, { operatorId, name: "Newsletter site", commandId })).projectId).toBe(created.projectId);
    await expect(createProject(pool, { operatorId: other.operatorId, name: "x", commandId })).rejects.toThrow(/another operator/);
    await expect(createProject(pool, { operatorId, name: " ", commandId: randomUUID() })).rejects.toBeInstanceOf(InvalidProjectNameError);

    await pool.query("INSERT INTO goals (goal_id, project_id, state, version, created_at, updated_at) VALUES ($1, $2, 'active', 1, now(), now()), ($3, $2, 'succeeded', 1, now(), now())", [randomUUID(), created.projectId, randomUUID()]);
    const catalog = await listProjectCatalog(pool, operatorId);
    expect(catalog.map((project) => [project.projectId, project.kind])).toEqual([[home, "home"], [created.projectId, "project"]]);
    expect(catalog[1]).toMatchObject({ goalCount: 2, activeGoalCount: 1 });
    expect((await pool.query("SELECT role_id FROM operator_project_roles WHERE operator_id = $1 AND project_id = $2", [operatorId, created.projectId])).rows).toEqual([{ role_id: "concertmaster" }]);
    expect((await listProjectCatalog(pool, other.operatorId)).map((project) => project.projectId)).toEqual([other.home]);

    expect((await renameProject(pool, { operatorId, projectId: created.projectId, name: "Newsletter" })).name).toBe("Newsletter");
    await expect(renameProject(pool, { operatorId: other.operatorId, projectId: created.projectId, name: "Stolen" })).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});
