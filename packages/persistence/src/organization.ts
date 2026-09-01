import {
  PERMANENT_DEPARTMENTS,
  PERMANENT_GROUPS,
  PERSONA_AXES,
  SANE_ROLE,
  parsePersonaProfile,
  type PermanentDepartment,
  type PermanentGroup,
  type PermanentRole,
  type PersonaAxis,
  type PersonaProfile,
} from "@maestro/domain";
import type { Pool, PoolClient } from "pg";

export interface PermanentOrganizationTaxonomy {
  readonly groups: readonly PermanentGroup[];
  readonly departments: readonly PermanentDepartment[];
}

type Queryable = Pick<PoolClient, "query">;

/**
 * Idempotently writes the canonical permanent identity records. It creates no
 * Goal participation or agent session; those are later-phase transient data.
 */
export async function bootstrapPermanentOrganization(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const group of PERMANENT_GROUPS) {
      await client.query(
        "INSERT INTO organization_groups (group_id, display_name) VALUES ($1, $2) ON CONFLICT (group_id) DO NOTHING",
        [group.groupId, group.displayName],
      );
    }
    for (const department of PERMANENT_DEPARTMENTS) {
      await client.query(
        `INSERT INTO departments (department_id, group_id, display_name, status)
         VALUES ($1, $2, $3, $4) ON CONFLICT (department_id) DO NOTHING`,
        [department.departmentId, department.groupId, department.displayName, department.status],
      );
    }
    await client.query(
      `INSERT INTO permanent_roles (role_id, display_name, status, department_id)
       VALUES ($1, $2, $3, NULL) ON CONFLICT (role_id) DO NOTHING`,
      [SANE_ROLE.roleId, SANE_ROLE.displayName, SANE_ROLE.status],
    );
    for (const axis of PERSONA_AXES) {
      await client.query(
        `INSERT INTO role_persona_axes (role_id, axis, value)
         VALUES ($1, $2, $3) ON CONFLICT (role_id, axis) DO NOTHING`,
        [SANE_ROLE.roleId, axis, SANE_ROLE.persona[axis]],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPermanentOrganization(pool: Pool): Promise<PermanentOrganizationTaxonomy> {
  const [groups, departments] = await Promise.all([
    pool.query<{ group_id: string; display_name: string }>("SELECT group_id, display_name FROM organization_groups ORDER BY group_id"),
    pool.query<{ department_id: string; group_id: string; display_name: string; status: "sleeping" }>(
      "SELECT department_id, group_id, display_name, status FROM departments ORDER BY department_id",
    ),
  ]);
  return {
    groups: groups.rows.map((row) => ({ groupId: row.group_id, displayName: row.display_name })),
    departments: departments.rows.map((row) => ({
      departmentId: row.department_id, groupId: row.group_id, displayName: row.display_name,
      status: row.status, activeSessionId: null, goalContext: null,
    })),
  };
}

export async function getPermanentRole(pool: Pool, roleId: string): Promise<PermanentRole | undefined> {
  const role = await pool.query<{ role_id: string; display_name: string; status: "standing"; department_id: null }>(
    "SELECT role_id, display_name, status, department_id FROM permanent_roles WHERE role_id = $1", [roleId],
  );
  if (role.rowCount !== 1) return undefined;
  const persona = await getPersona(pool, roleId);
  const row = role.rows[0]!;
  return {
    roleId: row.role_id, displayName: row.display_name, status: row.status, departmentId: row.department_id,
    persona, activeSessionId: null, goalContext: null,
  };
}

async function getPersona(pool: Queryable, roleId: string): Promise<PersonaProfile> {
  const axes = await pool.query<{ axis: PersonaAxis; value: string }>(
    "SELECT axis, value::text FROM role_persona_axes WHERE role_id = $1", [roleId],
  );
  return parsePersonaProfile(Object.fromEntries(axes.rows.map((row) => [row.axis, Number(row.value)])));
}
