import {
  PERMANENT_DEPARTMENTS,
  PERMANENT_GROUPS,
  PERMANENT_ROLES,
  PERSONA_AXES,
  PermanentRoleKindSchema,
  parsePersonaProfile,
  parseRoleCapabilityBoundary,
  parseRoleProvenance,
  type PermanentDepartment,
  type PermanentGroup,
  type PermanentRole,
  type PermanentRoleKind,
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
    for (const role of PERMANENT_ROLES) {
      await client.query(
        `INSERT INTO permanent_roles
           (role_id, display_name, status, department_id, role_kind, role_charter, capability_boundary, provenance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (role_id) DO NOTHING`,
        [
          role.roleId, role.displayName, role.status, role.departmentId, role.roleKind, role.charter,
          role.capabilityBoundary, role.provenance,
        ],
      );
      for (const axis of PERSONA_AXES) {
        await client.query(
          `INSERT INTO role_persona_axes (role_id, axis, value)
           VALUES ($1, $2, $3) ON CONFLICT (role_id, axis) DO NOTHING`,
          [role.roleId, axis, role.persona[axis]],
        );
      }
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

interface PermanentRoleRow {
  role_id: string;
  display_name: string;
  status: "standing";
  role_kind: PermanentRoleKind;
  department_id: string | null;
  role_charter: string;
  capability_boundary: unknown;
  provenance: unknown;
}

export async function listPermanentRoles(pool: Pool): Promise<readonly PermanentRole[]> {
  const result = await pool.query<PermanentRoleRow>(
    `SELECT role_id, display_name, status, role_kind, department_id, role_charter, capability_boundary, provenance
       FROM permanent_roles ORDER BY role_id`,
  );
  return Promise.all(result.rows.map(async (row) => toPermanentRole(row, await getPersona(pool, row.role_id))));
}

export async function getPermanentRole(pool: Pool, roleId: string): Promise<PermanentRole | undefined> {
  const role = await pool.query<PermanentRoleRow>(
    `SELECT role_id, display_name, status, role_kind, department_id, role_charter, capability_boundary, provenance
       FROM permanent_roles WHERE role_id = $1`, [roleId],
  );
  if (role.rowCount !== 1) return undefined;
  const row = role.rows[0]!;
  return toPermanentRole(row, await getPersona(pool, roleId));
}

function toPermanentRole(row: PermanentRoleRow, persona: PersonaProfile): PermanentRole {
  const boundary = parseRoleCapabilityBoundary(row.capability_boundary);
  const provenance = parseRoleProvenance(row.provenance);
  return Object.freeze({
    roleId: row.role_id,
    displayName: row.display_name,
    roleKind: PermanentRoleKindSchema.parse(row.role_kind),
    status: row.status,
    departmentId: row.department_id,
    charter: row.role_charter,
    capabilityBoundary: Object.freeze({
      allowed: Object.freeze([...boundary.allowed]),
      forbidden: Object.freeze([...boundary.forbidden]),
    }),
    provenance: Object.freeze({ ...provenance }),
    persona: Object.freeze({ ...persona }),
    activeSessionId: null,
    goalContext: null,
  });
}

async function getPersona(pool: Queryable, roleId: string): Promise<PersonaProfile> {
  const axes = await pool.query<{ axis: PersonaAxis; value: string }>(
    "SELECT axis, value::text FROM role_persona_axes WHERE role_id = $1", [roleId],
  );
  return parsePersonaProfile(Object.fromEntries(axes.rows.map((row) => [row.axis, Number(row.value)])));
}
