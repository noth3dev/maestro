import { Pool } from "pg";
import { applyAllMigrations } from "./test-migrations.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMANENT_DEPARTMENTS, PERMANENT_GROUPS, PERMANENT_ROLES, CONCERTMASTER_PERSONA_BASELINE } from "@maestro/domain";
import { bootstrapPermanentOrganization, getPermanentRole, listPermanentOrganization, listPermanentRoles } from "./organization.js";

const databaseUrl = process.env.MAESTRO_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("permanent organization with PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => { await applyAllMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("bootstraps the full permanent taxonomy idempotently without Goal context or active sessions", async () => {
    await bootstrapPermanentOrganization(pool);
    await bootstrapPermanentOrganization(pool);

    const taxonomy = await listPermanentOrganization(pool);
    expect(taxonomy.groups).toEqual([...PERMANENT_GROUPS].sort((a, b) => a.groupId.localeCompare(b.groupId)));
    expect(taxonomy.departments).toEqual([...PERMANENT_DEPARTMENTS].sort((a, b) => a.departmentId.localeCompare(b.departmentId)));
    expect(taxonomy.departments).toHaveLength(10);
    expect(taxonomy.departments.every((department) => department.status === "sleeping" && department.activeSessionId === null && department.goalContext === null)).toBe(true);

    await expect(getPermanentRole(pool, "concertmaster")).resolves.toMatchObject({
      roleId: "concertmaster", persona: CONCERTMASTER_PERSONA_BASELINE, activeSessionId: null, goalContext: null,
    });
    await expect(listPermanentRoles(pool)).resolves.toEqual(
      [...PERMANENT_ROLES].sort((a, b) => a.roleId.localeCompare(b.roleId)),
    );
  });
});
