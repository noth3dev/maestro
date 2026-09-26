import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type ProjectKind = "home" | "project";

export interface ProjectRecord {
  readonly projectId: string;
  readonly name: string;
  readonly kind: ProjectKind;
  readonly createdAt: string;
  /** Goals in the project, and those not yet finished. */
  readonly goalCount: number;
  readonly activeGoalCount: number;
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ProjectNotFoundError";
  }
}

export class InvalidProjectNameError extends Error {
  constructor() {
    super("Project name must be 1–120 characters");
    this.name = "InvalidProjectNameError";
  }
}

function projectName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "" || trimmed.length > 120) throw new InvalidProjectNameError();
  return trimmed;
}

const TERMINAL_GOAL_STATES = ["stopped", "succeeded", "failed"];

const CATALOG_SELECT = `
  SELECT p.project_id, p.name, p.kind, p.created_at,
         (SELECT count(*)::int FROM goals g WHERE g.project_id = p.project_id) AS goal_count,
         (SELECT count(*)::int FROM goals g WHERE g.project_id = p.project_id AND NOT (g.state = ANY($2::text[]))) AS active_goal_count
    FROM projects p
    JOIN operator_project_memberships m ON m.project_id = p.project_id AND m.active AND m.operator_id = $1`;

type CatalogRow = { project_id: string; name: string; kind: ProjectKind; created_at: Date; goal_count: number; active_goal_count: number };

function toRecord(row: CatalogRow): ProjectRecord {
  return {
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at.toISOString(),
    goalCount: Number(row.goal_count),
    activeGoalCount: Number(row.active_goal_count),
  };
}

/** Make sure the operator's Home project (the global workspace) is a named record. */
export async function ensureHomeProject(pool: Pool, operatorId: string, projectId: string): Promise<void> {
  await pool.query(
    `INSERT INTO projects (project_id, name, kind, created_by)
     SELECT $1, 'Home', 'home', $2
      WHERE NOT EXISTS (SELECT 1 FROM projects WHERE kind = 'home' AND created_by = $2)
     ON CONFLICT DO NOTHING`,
    [projectId, operatorId],
  );
}

/** Projects the operator belongs to: Home first, then newest first. */
export async function listProjectCatalog(pool: Pool, operatorId: string): Promise<readonly ProjectRecord[]> {
  const rows = await pool.query<CatalogRow>(`${CATALOG_SELECT} ORDER BY (p.kind = 'home') DESC, p.created_at DESC, p.project_id`, [operatorId, TERMINAL_GOAL_STATES]);
  return rows.rows.map(toRecord);
}

export async function readProject(pool: Pool, operatorId: string, projectId: string): Promise<ProjectRecord> {
  const rows = await pool.query<CatalogRow>(`${CATALOG_SELECT} WHERE p.project_id = $3`, [operatorId, TERMINAL_GOAL_STATES, projectId]);
  const row = rows.rows[0];
  if (row === undefined) throw new ProjectNotFoundError();
  return toRecord(row);
}

/**
 * Create a project the operator owns. The operator gets the same standing
 * roles there as in their Home project. Replaying a command returns the same
 * project.
 */
export async function createProject(pool: Pool, input: { readonly operatorId: string; readonly name: string; readonly commandId: string }): Promise<ProjectRecord> {
  const name = projectName(input.name);
  const client = await pool.connect();
  let projectId: string;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('project-create:' || $1, 0))", [input.commandId]);
    const prior = await client.query<{ project_id: string; created_by: string | null }>("SELECT project_id, created_by FROM projects WHERE create_command_id = $1", [input.commandId]);
    if (prior.rowCount === 1) {
      if (prior.rows[0]!.created_by !== input.operatorId) throw new Error("Project command identity was reused by another operator");
      projectId = prior.rows[0]!.project_id;
    } else {
      projectId = randomUUID();
      await client.query("INSERT INTO projects (project_id, name, kind, created_by, create_command_id) VALUES ($1, $2, 'project', $3, $4)", [projectId, name, input.operatorId, input.commandId]);
      await client.query("INSERT INTO operator_project_memberships (membership_id, operator_id, project_id, active) VALUES ($1, $2, $3, true)", [randomUUID(), input.operatorId, projectId]);
      const homeRoles = await client.query<{ role_id: string }>(
        `SELECT DISTINCT r.role_id FROM operator_project_roles r
           JOIN projects p ON p.project_id = r.project_id AND p.kind = 'home' AND p.created_by = $1
          WHERE r.operator_id = $1 AND r.active`,
        [input.operatorId],
      );
      const roles = homeRoles.rows.length > 0 ? homeRoles.rows.map((row) => row.role_id) : ["concertmaster"];
      for (const roleId of roles)
        await client.query("INSERT INTO operator_project_roles (grant_id, operator_id, project_id, role_id, active) VALUES ($1, $2, $3, $4, true)", [randomUUID(), input.operatorId, projectId, roleId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return readProject(pool, input.operatorId, projectId);
}

export async function renameProject(pool: Pool, input: { readonly operatorId: string; readonly projectId: string; readonly name: string }): Promise<ProjectRecord> {
  const name = projectName(input.name);
  const result = await pool.query(
    `UPDATE projects p SET name = $3, updated_at = transaction_timestamp()
      WHERE p.project_id = $2
        AND EXISTS (SELECT 1 FROM operator_project_memberships m WHERE m.project_id = p.project_id AND m.operator_id = $1 AND m.active)`,
    [input.operatorId, input.projectId, name],
  );
  if (result.rowCount !== 1) throw new ProjectNotFoundError();
  return readProject(pool, input.operatorId, input.projectId);
}
