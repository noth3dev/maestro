import { randomUUID } from "node:crypto";
import type { ProjectAccessProvisionInput, ProjectAccessProvisionResult } from "@maestro/contracts";
import type { Pool, PoolClient } from "pg";

export class ProjectMembershipError extends Error {}
export class ProjectMembershipRequiredError extends ProjectMembershipError {
  constructor(operatorId: string, projectId: string) {
    super(`Operator ${operatorId} has no active membership for project ${projectId}`);
    this.name = "ProjectMembershipRequiredError";
  }
}

/**
 * Grants an operator durable access to a project. Idempotent: granting an
 * already-active membership again inserts no duplicate row. After a
 * revoke, granting again inserts a genuinely new membership row (a
 * revoked row can never itself be reactivated -- see the migration's
 * trigger -- matching this codebase's existing credential-rotation
 * pattern of "issue a new one" rather than "resurrect the old one").
 */
export async function grantProjectMembership(pool: Pool, operatorId: string, projectId: string): Promise<void> {
  await pool.query(
    `INSERT INTO operator_project_memberships (membership_id, operator_id, project_id, active)
     SELECT $1, $2, $3, true
     WHERE NOT EXISTS (
       SELECT 1 FROM operator_project_memberships WHERE operator_id = $2 AND project_id = $3 AND active = true
     )
     ON CONFLICT (operator_id, project_id) WHERE active DO NOTHING`,
    [randomUUID(), operatorId, projectId],
  );
}

/** One-way. Revoking an already-revoked or nonexistent membership is a safe no-op. */
export async function revokeProjectMembership(pool: Pool, operatorId: string, projectId: string): Promise<void> {
  await pool.query(
    `UPDATE operator_project_memberships SET active = false, revoked_at = transaction_timestamp()
     WHERE operator_id = $1 AND project_id = $2 AND active = true`,
    [operatorId, projectId],
  );
}

/**
 * Fails closed unless the operator currently holds an active membership for
 * this exact project. This is the minimal Phase 1 authorization boundary:
 * membership existence only, not per-action role/capability granularity
 * (a documented, separately tracked future refinement) -- but it closes the
 * concrete gap that authentication alone let any valid credential act on
 * any project's Goals regardless of organizational membership.
 */
export async function assertProjectMembership(pool: Pool, operatorId: string, projectId: string): Promise<void> {
  const result = await pool.query(
    "SELECT 1 FROM operator_project_memberships WHERE operator_id = $1 AND project_id = $2 AND active = true",
    [operatorId, projectId],
  );
  if (result.rowCount !== 1) throw new ProjectMembershipRequiredError(operatorId, projectId);
}

export async function listProjectMemberships(pool: Pool, operatorId: string): Promise<readonly string[]> {
  const result = await pool.query<{ project_id: string }>(
    "SELECT project_id FROM operator_project_memberships WHERE operator_id = $1 AND active = true ORDER BY granted_at",
    [operatorId],
  );
  return result.rows.map((row) => row.project_id);
}

export class ProjectRoleRequiredError extends ProjectMembershipError {
  constructor(operatorId: string, projectId: string, roleId: string) {
    super(`Operator ${operatorId} has no active ${roleId} role for project ${projectId}`);
    this.name = "ProjectRoleRequiredError";
  }
}

/** Grants one exact role for a project. A role is never reactivated after revocation. */
export async function grantProjectRole(pool: Pool, operatorId: string, projectId: string, roleId: string): Promise<void> {
  if (roleId.trim() === "") throw new Error("Project role must be non-empty");
  await pool.query(
    `INSERT INTO operator_project_roles (grant_id, operator_id, project_id, role_id, active)
     SELECT $1, $2, $3, $4, true
     WHERE NOT EXISTS (
       SELECT 1 FROM operator_project_roles
       WHERE operator_id = $2 AND project_id = $3 AND role_id = $4 AND active = true
     )
     ON CONFLICT (operator_id, project_id, role_id) WHERE active DO NOTHING`,
    [randomUUID(), operatorId, projectId, roleId.trim()],
  );
}

/** Fails closed unless membership and the exact active project role both exist. */
export async function assertProjectRole(pool: Pool | PoolClient, operatorId: string, projectId: string, roleId: string): Promise<void> {
  const result = await pool.query(
    `SELECT 1
       FROM operator_project_roles r
       JOIN operator_project_memberships m ON m.operator_id = r.operator_id AND m.project_id = r.project_id AND m.active = true
      WHERE r.operator_id = $1 AND r.project_id = $2 AND r.role_id = $3 AND r.active = true`,
    [operatorId, projectId, roleId],
  );
  if (result.rowCount !== 1) throw new ProjectRoleRequiredError(operatorId, projectId, roleId);
}

export async function revokeProjectRole(pool: Pool, operatorId: string, projectId: string, roleId: string): Promise<void> {
  await pool.query(
    `UPDATE operator_project_roles SET active = false, revoked_at = transaction_timestamp()
      WHERE operator_id = $1 AND project_id = $2 AND role_id = $3 AND active = true`,
    [operatorId, projectId, roleId],
  );
}


export class ProjectAccessAdminRequiredError extends ProjectMembershipError {
  constructor() {
    super("Project access provisioning requires the configured operator admin");
    this.name = "ProjectAccessAdminRequiredError";
  }
}

export class ProjectAccessTargetNotFoundError extends ProjectMembershipError {
  constructor() {
    super("Target operator does not exist or is not active");
    this.name = "ProjectAccessTargetNotFoundError";
  }
}

export class ProjectAccessRoleNotFoundError extends ProjectMembershipError {
  constructor(readonly roleId: string) {
    super(`Project role is not a standing permanent role: ${roleId}`);
    this.name = "ProjectAccessRoleNotFoundError";
  }
}

/**
 * Atomically grants a target operator membership and exact standing permanent
 * roles. The explicit admin identity is checked before any write; the target
 * must already be an active authenticated-operator record. This is the only
 * production provisioning path and never accepts free-form capabilities.
 */
export async function provisionProjectAccess(
  pool: Pool,
  requesterOperatorId: string,
  input: ProjectAccessProvisionInput,
  options: { adminOperatorId: string },
): Promise<ProjectAccessProvisionResult> {
  if (requesterOperatorId !== options.adminOperatorId) throw new ProjectAccessAdminRequiredError();
  const roleIds = input.roles.map((roleId) => roleId.trim());
  if (roleIds.length === 0 || roleIds.some((roleId) => roleId.length === 0) || new Set(roleIds).size !== roleIds.length) {
    throw new Error("Project roles must be non-empty and unique");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admin = await client.query<{ active: boolean }>(
      "SELECT active FROM local_operators WHERE operator_id = $1 FOR SHARE",
      [requesterOperatorId],
    );
    if (admin.rowCount !== 1 || !admin.rows[0]!.active) throw new ProjectAccessAdminRequiredError();

    const target = await client.query<{ active: boolean }>(
      "SELECT active FROM local_operators WHERE operator_id = $1 FOR UPDATE",
      [input.operatorId],
    );
    if (target.rowCount !== 1 || !target.rows[0]!.active) throw new ProjectAccessTargetNotFoundError();

    const standingRoles = await client.query<{ role_id: string }>(
      `SELECT role_id FROM permanent_roles
        WHERE role_id = ANY($1::text[]) AND status = 'standing'`,
      [roleIds],
    );
    const standingRoleIds = new Set(standingRoles.rows.map((row) => row.role_id));
    const unknownRole = roleIds.find((roleId) => !standingRoleIds.has(roleId));
    if (unknownRole !== undefined) throw new ProjectAccessRoleNotFoundError(unknownRole);

    await client.query(
      `INSERT INTO operator_project_memberships (membership_id, operator_id, project_id, active)
       SELECT $1, $2, $3, true
       WHERE NOT EXISTS (
         SELECT 1 FROM operator_project_memberships
         WHERE operator_id = $2 AND project_id = $3 AND active = true
       )
       ON CONFLICT (operator_id, project_id) WHERE active DO NOTHING`,
      [randomUUID(), input.operatorId, input.projectId],
    );
    for (const roleId of roleIds) {
      await client.query(
        `INSERT INTO operator_project_roles (grant_id, operator_id, project_id, role_id, active)
         SELECT $1, $2, $3, $4, true
         WHERE NOT EXISTS (
           SELECT 1 FROM operator_project_roles
           WHERE operator_id = $2 AND project_id = $3 AND role_id = $4 AND active = true
         )
         ON CONFLICT (operator_id, project_id, role_id) WHERE active DO NOTHING`,
        [randomUUID(), input.operatorId, input.projectId, roleId],
      );
    }
    await client.query("COMMIT");
    return { operatorId: input.operatorId, projectId: input.projectId, roles: roleIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
